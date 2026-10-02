import fs from "node:fs/promises";
import nodeUrl from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestHarness } from "wrangler";

import { ConversionPhase } from "@cup/conversion-contracts";
import type { SegmentUsage } from "@cup/conversion-contracts/duration-accounting";
import type { ConversionGrantDurableObject } from "@cup/conversion-grants";
import { createRootCredential } from "@cup/conversion-grants/session";

import type { RegistryDurableObject } from "#src/index.ts";

type TestEnvironment = {
  CONVERSION_GRANTS: DurableObjectNamespace<ConversionGrantDurableObject>;
  REGISTRY: DurableObjectNamespace<RegistryDurableObject>;
};
const CREATED_AT_MS = 2_000_000_000_000;
const EXPIRES_AT_MS = CREATED_AT_MS + 90 * 24 * 60 * 60 * 1_000;
const harness = createTestHarness({
  root: nodeUrl.fileURLToPath(new URL("..", import.meta.url)),
  workers: [{ configPath: "./wrangler.test.jsonc" }],
});
const worker = harness.getWorker();
let testEnvironment: TestEnvironment | undefined;

beforeAll(async () => {
  await harness.listen();
  const environment: unknown = await worker.getEnv();
  if (!isTestEnvironment(environment))
    throw new Error("The conversion grant test bindings are unavailable.");
  testEnvironment = environment;
}, 30_000);

afterAll(async () => {
  await harness.close();
});

describe("SQLite conversion grant Durable Object", () => {
  test("replays schema migrations and persists the authoritative record", async () => {
    const grant = grantStub("migration");
    expect(await grant.migrate()).toBe(6);
    expect(await grant.migrate()).toBe(6);
    await grant.initialize(grantId("migration"), CREATED_AT_MS, EXPIRES_AT_MS);

    const storage = await worker.getDurableObjectStorage("CONVERSION_GRANTS", {
      name: "migration",
    });
    const migrations = await storage.exec("SELECT * FROM __drizzle_migrations");
    expect(migrations).toHaveLength(1);
    expect((await grant.inspect(CREATED_AT_MS)).state).toBe("open");
  });

  test("installs a non-recoverable verifier and invalidates signed sessions", async () => {
    const id = grantId("session");
    const grant = grantStub("session");
    await grant.initialize(id, CREATED_AT_MS, EXPIRES_AT_MS);
    const root = await createRootCredential();
    expect(await grant.installCredentialVerifier(root.verifier, CREATED_AT_MS)).toBe("installed");
    expect(await grant.installCredentialVerifier("replacement", CREATED_AT_MS)).toBe(
      "already-issued",
    );
    expect((await grant.exchangeCredential("v1.wrong", CREATED_AT_MS)).result).toBe(
      "invalid-credential",
    );

    const exchanged = await grant.exchangeCredential(root.credential, CREATED_AT_MS);
    if (exchanged.result !== "created") throw new Error("Credential exchange failed.");
    expect((await grant.validateSession(exchanged.sessionToken, EXPIRES_AT_MS)).result).toBe(
      "valid",
    );

    await grant.invalidateSessions(CREATED_AT_MS + 1);
    expect((await grant.validateSession(exchanged.sessionToken, CREATED_AT_MS + 2)).result).toBe(
      "invalid",
    );
    expect((await grant.exchangeCredential(root.credential, CREATED_AT_MS + 2)).result).toBe(
      "grant-revoked",
    );
  });

  test("persists the last started conversion phase in SQLite", async () => {
    const grant = grantStub("phase");
    await grant.initialize(grantId("phase"), CREATED_AT_MS, EXPIRES_AT_MS);
    const accepted = await grant.startConversion(
      "https://example.com/phase",
      grantId("phase-request"),
      CREATED_AT_MS,
    );
    if (accepted.result !== "created") throw new Error("Conversion was not accepted.");

    expect(accepted.conversion.lastStartedPhase).toBe(ConversionPhase.CONVERSION_START);
    await grant.recordPhaseStarted(
      accepted.conversion.conversionId,
      ConversionPhase.AUDIO_SEGMENT_PRODUCTION,
    );
    expect((await grant.getConversion(accepted.conversion.conversionId))?.lastStartedPhase).toBe(
      ConversionPhase.AUDIO_SEGMENT_PRODUCTION,
    );

    const storage = await worker.getDurableObjectStorage("CONVERSION_GRANTS", { name: "phase" });
    const rows = await storage.exec<{ last_started_phase: string }>(
      "SELECT last_started_phase FROM conversions WHERE conversion_id = ?",
      accepted.conversion.conversionId,
    );
    expect(rows).toEqual([{ last_started_phase: ConversionPhase.AUDIO_SEGMENT_PRODUCTION }]);
  });

  test("serializes starts without reserving duration for source preparation", async () => {
    const grant = grantStub("duration");
    await grant.initialize(grantId("duration"), CREATED_AT_MS, EXPIRES_AT_MS);
    const first = await grant.startConversion(
      "https://example.com/one",
      grantId("request-one"),
      CREATED_AT_MS,
    );
    expect(first.result).toBe("created");
    const replay = await grant.startConversion(
      "https://example.com/one",
      grantId("request-one"),
      CREATED_AT_MS + 1,
    );
    expect(replay.result).toBe("replayed");
    expect(
      (
        await grant.startConversion(
          "https://example.com/conflict",
          grantId("request-one"),
          CREATED_AT_MS + 2,
        )
      ).result,
    ).toBe("idempotency-conflict");

    for (let index = 2; index <= 5; index += 1) {
      const accepted = await grant.startConversion(
        `https://example.com/${index}`,
        grantId(`request-${index}`),
        CREATED_AT_MS + index * 61_000,
      );
      expect(accepted.result).toBe("created");
    }
    const full = await grant.startConversion(
      "https://example.com/six",
      grantId("request-six"),
      CREATED_AT_MS + 6 * 61_000,
    );
    expect(full.result).toBe("created");
    expect((await grant.inspect(CREATED_AT_MS + 6 * 61_000)).duration).toEqual({
      availableMilliseconds: 7_200_000,
      reservedMilliseconds: 0,
      spentMilliseconds: 0,
    });

    if (first.result !== "created") throw new Error("The first conversion was not accepted.");
    await grant.recordFailed(first.conversion.conversionId, {
      completedAtMs: CREATED_AT_MS + 7 * 61_000,
      failureCategory: "source-preparation",
      explanation: "The source page could not be loaded.",
      cleanupState: "complete",
    });
    expect((await grant.inspect(CREATED_AT_MS + 7 * 61_000)).duration.availableMilliseconds).toBe(
      7_200_000,
    );
  });

  test("finalization alone does not charge duration and rejects contradictory terminals", async () => {
    const grant = grantStub("terminal");
    await grant.initialize(grantId("terminal"), CREATED_AT_MS, EXPIRES_AT_MS);
    const accepted = await grant.startConversion(
      "https://example.com/ready",
      grantId("ready-request"),
      CREATED_AT_MS,
    );
    if (accepted.result !== "created") throw new Error("Conversion was not accepted.");
    const ready = {
      completedAtMs: CREATED_AT_MS + 1,
      title: "Ready",
      audiobookReference: {
        key: "conversions/ready/audiobook.json",
        contentType: "application/json" as const,
        byteLength: 42,
        etag: "ready-etag",
      },
    };
    expect(await grant.recordReady(accepted.conversion.conversionId, ready)).toBe("recorded");
    expect(await grant.recordReady(accepted.conversion.conversionId, ready)).toBe("replayed");
    await expectWorkerRpcRejection(
      grant.recordFailed(accepted.conversion.conversionId, {
        completedAtMs: CREATED_AT_MS + 2,
        failureCategory: "internal",
        explanation: "Contradiction",
      }),
    );
    expect((await grant.inspect(CREATED_AT_MS + 2)).duration).toEqual({
      availableMilliseconds: 7_200_000,
      reservedMilliseconds: 0,
      spentMilliseconds: 0,
    });
  });

  test("records a recovered conversion without a second charge", async () => {
    const grant = grantStub("recovered-terminal");
    await grant.initialize(grantId("recovered-terminal"), CREATED_AT_MS, EXPIRES_AT_MS);
    const accepted = await grant.startConversion(
      "https://example.com/recovered",
      grantId("recovered-request"),
      CREATED_AT_MS,
    );
    if (accepted.result !== "created") throw new Error("Conversion was not accepted.");
    await grant.recordFailed(accepted.conversion.conversionId, {
      completedAtMs: CREATED_AT_MS + 1,
      failureCategory: "source-preparation",
      explanation: "The source page could not be loaded.",
      cleanupState: "complete",
    });

    const ready = {
      completedAtMs: CREATED_AT_MS + 2,
      title: "Recovered",
      audiobookReference: {
        key: `conversions/${accepted.conversion.conversionId}/audiobook.json`,
        contentType: "application/json" as const,
        byteLength: 42,
        etag: "recovered-etag",
      },
    };
    expect(await grant.recordReady(accepted.conversion.conversionId, ready)).toBe("recorded");
    expect(await grant.recordReady(accepted.conversion.conversionId, ready)).toBe("replayed");
    expect((await grant.inspect(CREATED_AT_MS + 2)).duration).toEqual({
      availableMilliseconds: 7_200_000,
      reservedMilliseconds: 0,
      spentMilliseconds: 0,
    });
  });

  test("accepts an already produced recovered audiobook independently of other conversion starts", async () => {
    const grant = grantStub("recovered-full");
    await grant.initialize(grantId("recovered-full"), CREATED_AT_MS, EXPIRES_AT_MS);
    const conversions = [];
    for (let index = 0; index < 5; index += 1) {
      const accepted = await grant.startConversion(
        `https://example.com/recovered-full-${index}`,
        grantId(`full-${index}`),
        CREATED_AT_MS + index * 61_000,
      );
      expect(accepted.result).toBe("created");
      if (accepted.result !== "created") throw new Error("Conversion was not accepted.");
      conversions.push(accepted.conversion);
    }
    const failedConversion = conversions[0];
    if (failedConversion === undefined) throw new Error("Failed conversion is unavailable.");
    await grant.recordFailed(failedConversion.conversionId, {
      completedAtMs: CREATED_AT_MS + 5 * 61_000,
      failureCategory: "source-preparation",
      explanation: "The source page could not be loaded.",
      cleanupState: "complete",
    });
    expect(
      (
        await grant.startConversion(
          "https://example.com/replacement",
          grantId("replacement-request"),
          CREATED_AT_MS + 6 * 61_000,
        )
      ).result,
    ).toBe("created");

    expect(
      await grant.recordReady(failedConversion.conversionId, {
        completedAtMs: CREATED_AT_MS + 7 * 61_000,
        title: "Recovered too late",
        audiobookReference: {
          key: `conversions/${failedConversion.conversionId}/audiobook.json`,
          contentType: "application/json",
          byteLength: 42,
          etag: "recovered-full-etag",
        },
      }),
    ).toBe("recorded");
    expect((await grant.inspect(CREATED_AT_MS + 7 * 61_000)).duration).toEqual({
      availableMilliseconds: 7_200_000,
      reservedMilliseconds: 0,
      spentMilliseconds: 0,
    });
  });

  test("enforces a rolling start limit without accepting an extra conversion", async () => {
    const grant = grantStub("rate-limit");
    await grant.initialize(grantId("rate-limit"), CREATED_AT_MS, EXPIRES_AT_MS);
    const results = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        grant.startConversion(
          `https://example.com/rate-${index}`,
          grantId(`rate-request-${index}`),
          CREATED_AT_MS,
        ),
      ),
    );
    expect(results.filter((result) => result.result === "created")).toHaveLength(10);
    expect(results.filter((result) => result.result === "rate-limited")).toHaveLength(1);
    expect(await grant.listConversions()).toHaveLength(10);
  });
});

describe("SQLite conversion grant Registry Durable Object", () => {
  test("persists grants and conversion bindings beyond one SQL parameter batch", async () => {
    const registry = registryStub("registry-batches");
    const entries = [];
    for (let index = 0; index < 8; index++) {
      const { entry } = await registry.reserveProvisioning(
        grantId(`batch-request-${index}`),
        `Batch ${index}`,
        CREATED_AT_MS + index,
      );
      entries.push(entry);
    }
    const first = entries[0];
    if (first === undefined) throw new Error("Expected a provisioned grant.");
    for (let index = 0; index < 51; index++)
      await registry.bindConversion(grantId(`batch-conversion-${index}`), first.grantId);

    expect((await registry.listGrants({ limit: 100 }, CREATED_AT_MS)).grants).toHaveLength(8);
    for (let index = 0; index < 51; index++)
      expect(await registry.findGrantIdForConversion(grantId(`batch-conversion-${index}`))).toBe(
        first.grantId,
      );

    const storage = await worker.getDurableObjectStorage("REGISTRY", {
      name: "registry-batches",
    });
    await storage.exec(`CREATE TRIGGER reject_failed_batch BEFORE INSERT ON registry_grants
      WHEN NEW.label = 'Reject this grant'
      BEGIN SELECT RAISE(ABORT, 'Injected later-batch failure'); END`);
    await expectWorkerRpcRejection(
      registry.reserveProvisioning(
        grantId("rejected-batch-request"),
        "Reject this grant",
        CREATED_AT_MS + 8,
      ),
    );
    expect((await registry.listGrants({ limit: 100 }, CREATED_AT_MS)).grants).toHaveLength(8);
    expect(await registry.findGrantIdForConversion(grantId("batch-conversion-50"))).toBe(
      first.grantId,
    );
    expect((await registry.reserveProvisioning(first.requestId, first.label)).created).toBe(false);
  });

  test("binds request IDs, pages snapshots, and rejects same-revision conflicts", async () => {
    const registry = registryStub("registry");
    expect(await registry.migrate()).toBe(4);
    const first = await registry.reserveProvisioning(
      grantId("provision-one"),
      "Alpha",
      CREATED_AT_MS,
    );
    expect(first.created).toBe(true);
    expect(
      (await registry.reserveProvisioning(grantId("provision-one"), "Alpha", CREATED_AT_MS + 1))
        .entry.grantId,
    ).toBe(first.entry.grantId);
    await expectWorkerRpcRejection(
      registry.reserveProvisioning(grantId("provision-one"), "Different", CREATED_AT_MS + 1),
    );

    const grantSnapshot = {
      grantId: first.entry.grantId,
      revision: 1,
      reservedMilliseconds: 0,
      spentMilliseconds: 0,
      schemaVersion: 2,
      allowanceMilliseconds: 5,
    };
    await registry.activate(first.entry.requestId, grantSnapshot, true);
    expect(await registry.applyGrantRegistrySnapshot(grantSnapshot)).toBe("replayed");
    expect(await registry.applyGrantRegistrySnapshot({ ...grantSnapshot, revision: 0 })).toBe(
      "stale",
    );
    await expectWorkerRpcRejection(
      registry.applyGrantRegistrySnapshot({ ...grantSnapshot, reservedMilliseconds: 1 }),
    );

    const second = await registry.reserveProvisioning(
      grantId("provision-two"),
      "Alpha two",
      CREATED_AT_MS + 1,
    );
    await registry.activate(
      second.entry.requestId,
      { ...grantSnapshot, grantId: second.entry.grantId },
      true,
    );
    const firstPage = await registry.listGrants({ label: "alpha", limit: 1 }, CREATED_AT_MS + 2);
    expect(firstPage.grants).toHaveLength(1);
    expect(firstPage.nextCursor).toBeDefined();
    if (firstPage.nextCursor === undefined) throw new Error("The first page has no cursor.");
    const secondPage = await registry.listGrants(
      { label: "alpha", limit: 1, cursor: firstPage.nextCursor },
      CREATED_AT_MS + 2,
    );
    expect(secondPage.grants).toHaveLength(1);
    expect(secondPage.grants[0]?.grantId).not.toBe(firstPage.grants[0]?.grantId);
  });
});

function grantStub(name: string) {
  const environment = getTestEnvironment();
  return environment.CONVERSION_GRANTS.get(environment.CONVERSION_GRANTS.idFromName(name));
}

function registryStub(name: string) {
  const environment = getTestEnvironment();
  return environment.REGISTRY.get(environment.REGISTRY.idFromName(name));
}

function getTestEnvironment(): TestEnvironment {
  if (testEnvironment === undefined)
    throw new Error("The conversion grant test environment is unavailable.");
  return testEnvironment;
}

async function expectWorkerRpcRejection(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch {
    // Wrangler currently hides the Durable Object's original error behind its RPC transport.
    return;
  }
  throw new Error("The Durable Object operation was expected to reject.");
}

function isTestEnvironment(value: unknown): value is TestEnvironment {
  return (
    isRecord(value) &&
    isNamespaceShape(value["CONVERSION_GRANTS"]) &&
    isNamespaceShape(value["REGISTRY"])
  );
}

function isNamespaceShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["get"] === "function" &&
    typeof value["idFromName"] === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function grantId(seed: string): string {
  const bytes = new TextEncoder().encode(seed);
  const hex = Array.from({ length: 32 }, (_, index) =>
    (bytes[index % bytes.length] ?? 0).toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

test("changes duration allowance without replacing credentials or sessions", async () => {
  const grant = grantStub("allowance");
  await grant.initialize(grantId("allowance"), CREATED_AT_MS, EXPIRES_AT_MS);
  const root = await createRootCredential();
  await grant.installCredentialVerifier(root.verifier, CREATED_AT_MS);
  const exchange = await grant.exchangeCredential(root.credential, CREATED_AT_MS);
  if (exchange.result !== "created") throw new Error("Credential exchange failed");
  const accepted = await grant.startConversion(
    "https://example.com/allowance",
    crypto.randomUUID(),
    CREATED_AT_MS,
  );
  if (accepted.result !== "created") throw new Error("Conversion not accepted");
  expect((await grant.reserveAudioSegment(accepted.conversion.conversionId, 0, 100)).result).toBe(
    "reserved",
  );
  expect(await grant.setDurationAllowance(5_000, CREATED_AT_MS)).toEqual({
    result: "below-used-duration",
  });
  expect((await grant.setDurationAllowance(20_000, CREATED_AT_MS)).result).toBe("updated");
  expect(await grant.setDurationAllowance(20_000, CREATED_AT_MS)).toMatchObject({ changed: false });
  expect(await grant.validateSession(exchange.sessionToken, CREATED_AT_MS)).toMatchObject({
    result: "valid",
    snapshot: {
      duration: {
        availableMilliseconds: 12_000,
        reservedMilliseconds: 8_000,
        spentMilliseconds: 0,
      },
    },
  });
  expect((await grant.exchangeCredential(root.credential, CREATED_AT_MS)).result).toBe("created");
});

test("replays baselines without changing grant balances or registry bindings", async () => {
  const name = "allowance-migration";
  const grant = grantStub(name);
  await grant.initialize(grantId(name), CREATED_AT_MS, EXPIRES_AT_MS);
  const storage = await worker.getDurableObjectStorage("CONVERSION_GRANTS", { name });
  expect(await storage.exec("SELECT * FROM __drizzle_migrations")).toHaveLength(1);
  expect(await grant.migrate()).toBe(6);
  expect((await grant.inspect(CREATED_AT_MS)).duration.availableMilliseconds).toBe(7_200_000);
  const registry = registryStub(name);
  const { entry } = await registry.reserveProvisioning(
    crypto.randomUUID(),
    "Migration",
    CREATED_AT_MS,
  );
  const conversionId = crypto.randomUUID();
  await registry.bindConversion(conversionId, entry.grantId);
  const registryStorage = await worker.getDurableObjectStorage("REGISTRY", {
    name,
  });
  expect(await registryStorage.exec("SELECT * FROM __drizzle_migrations")).toHaveLength(1);
  expect(await registry.migrate()).toBe(4);
  expect(await registry.findGrantIdForConversion(conversionId)).toBe(entry.grantId);
  await registry.activate(
    entry.requestId,
    {
      grantId: entry.grantId,
      revision: 2,
      allowanceMilliseconds: 20,
      reservedMilliseconds: 0,
      spentMilliseconds: 6,
      schemaVersion: 5,
    },
    true,
  );
  expect((await registry.listGrants({ limit: 100 }, CREATED_AT_MS)).grants[0]?.state).toBe("open");
  await registry.applyGrantRegistrySnapshot({
    grantId: entry.grantId,
    revision: 3,
    allowanceMilliseconds: 20,
    reservedMilliseconds: 0,
    spentMilliseconds: 20,
    schemaVersion: 5,
  });
  expect((await registry.listGrants({ limit: 100 }, CREATED_AT_MS)).grants[0]?.state).toBe(
    "exhausted",
  );
});

test("persists segment usage as constrained rows without resetting the balance", async () => {
  const name = "segment-usage-table";
  const grant = grantStub(name);
  await grant.initialize(grantId(name), CREATED_AT_MS, EXPIRES_AT_MS);
  await grant.setDurationAllowance(20_000, CREATED_AT_MS);
  const root = await createRootCredential();
  await grant.installCredentialVerifier(root.verifier, CREATED_AT_MS);
  const session = await grant.exchangeCredential(root.credential, CREATED_AT_MS);
  if (session.result !== "created") throw new Error("Session not created");
  const first = await grant.startConversion(
    "https://example.com/first",
    crypto.randomUUID(),
    CREATED_AT_MS,
  );
  const second = await grant.startConversion(
    "https://example.com/second",
    crypto.randomUUID(),
    CREATED_AT_MS,
  );
  if (first.result !== "created" || second.result !== "created")
    throw new Error("Conversions not created");
  await grant.reserveAudioSegment(first.conversion.conversionId, 0, 10);
  await grant.completeAudioSegment(first.conversion.conversionId, 0, 800);
  await grant.reserveAudioSegment(first.conversion.conversionId, 1, 10);
  await grant.recordFailed(first.conversion.conversionId, {
    failureCategory: "narration-synthesis",
    explanation: "Later synthesis failed.",
  });
  await grant.reserveAudioSegment(second.conversion.conversionId, 0, 10);
  const before = await grant.inspect(CREATED_AT_MS);
  const storage = await worker.getDurableObjectStorage("CONVERSION_GRANTS", { name });
  const selectUsage = `SELECT conversion_id AS conversionId, sequence, narration_text_characters AS narrationTextCharacters,
    estimated_milliseconds AS estimatedMilliseconds, state, actual_milliseconds AS actualMilliseconds,
    charged_milliseconds AS chargedMilliseconds FROM segment_usage ORDER BY conversion_id, sequence`;
  const usage = await storage.exec<SegmentUsage>(selectUsage);
  expect(usage.map((segment) => segment.state).sort()).toEqual(["released", "reserved", "settled"]);
  expect(await grant.migrate()).toBe(6);
  expect(await storage.exec<SegmentUsage>(selectUsage)).toEqual(usage);
  expect((await grant.inspect(CREATED_AT_MS)).duration).toEqual(before.duration);
  expect(
    await storage.exec<{ allowance: number }>(
      "SELECT allowance_milliseconds AS allowance FROM grant",
    ),
  ).toEqual([{ allowance: 20_000 }]);
  expect((await grant.validateSession(session.sessionToken, CREATED_AT_MS)).result).toBe("valid");
  expect(await grant.migrate()).toBe(6);
  expect(await storage.exec<SegmentUsage>(selectUsage)).toEqual(usage);
  const columns = await storage.exec<{ name: string }>("PRAGMA table_info(grant)");
  expect(columns.map((column) => column.name)).not.toContain("segment_usage_json");

  await expect(
    storage.exec("INSERT INTO segment_usage SELECT * FROM segment_usage LIMIT 1"),
  ).rejects.toThrow(/UNIQUE constraint failed/);
  await expect(
    storage.exec(
      "UPDATE segment_usage SET charged_milliseconds = actual_milliseconds + 1 WHERE state = 'settled'",
    ),
  ).rejects.toThrow(/CHECK constraint failed/);
  await expect(
    storage.exec(
      "INSERT INTO segment_usage VALUES ('missing-conversion', 0, 10, 1000, 'reserved', 0, 0)",
    ),
  ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  // Continuing generation updates the existing row and leaves the other ledger entries intact.
  await grant.completeAudioSegment(second.conversion.conversionId, 0, 900);
  const after = await storage.exec<SegmentUsage>(selectUsage);
  expect(after).toHaveLength(usage.length);
  expect((await grant.inspect(CREATED_AT_MS)).duration).toEqual({
    availableMilliseconds: 18_300,
    reservedMilliseconds: 0,
    spentMilliseconds: 1_700,
  });
});

test("serializes concurrent duration reservations across conversions and absorbs aggregate overruns", async () => {
  const grant = grantStub("duration-concurrency");
  await grant.initialize(grantId("duration-concurrency"), CREATED_AT_MS, EXPIRES_AT_MS);
  await grant.setDurationAllowance(2_000, CREATED_AT_MS);
  const first = await grant.startConversion(
    "https://example.com/first",
    crypto.randomUUID(),
    CREATED_AT_MS,
  );
  const second = await grant.startConversion(
    "https://example.com/second",
    crypto.randomUUID(),
    CREATED_AT_MS,
  );
  if (first.result !== "created" || second.result !== "created")
    throw new Error("Conversions not accepted");
  const results = await Promise.all([
    grant.reserveAudioSegment(first.conversion.conversionId, 0, 1),
    grant.reserveAudioSegment(second.conversion.conversionId, 0, 1),
    grant.reserveAudioSegment(second.conversion.conversionId, 1, 1),
  ]);
  expect(results.map((result) => result.result)).toEqual([
    "reserved",
    "reserved",
    "temporarily-full",
  ]);
  expect((await grant.inspect(CREATED_AT_MS)).duration).toEqual({
    availableMilliseconds: 0,
    reservedMilliseconds: 2_000,
    spentMilliseconds: 0,
  });
  await grant.completeAudioSegment(first.conversion.conversionId, 0, 1_500);
  expect(await grant.setDurationAllowance(2_000, CREATED_AT_MS)).toMatchObject({
    result: "updated",
    changed: false,
  });
  await grant.completeAudioSegment(second.conversion.conversionId, 0, 1_600);
  expect((await grant.inspect(CREATED_AT_MS)).duration).toEqual({
    availableMilliseconds: 0,
    reservedMilliseconds: 0,
    spentMilliseconds: 2_000,
  });
  expect((await grant.completeAudioSegment(second.conversion.conversionId, 0, 1_600)).result).toBe(
    "replayed",
  );
  expect(await grant.listAudioSegments(second.conversion.conversionId)).toMatchObject([
    { actualMilliseconds: 1_600, chargedMilliseconds: 500 },
  ]);
  await grant.recordFailed(second.conversion.conversionId, {
    failureCategory: "narration-synthesis",
    explanation: "Later synthesis failed.",
  });
  expect(await grant.listAudioSegments(second.conversion.conversionId)).toHaveLength(1);
  expect((await grant.inspect(CREATED_AT_MS)).duration.spentMilliseconds).toBe(2_000);
});

test("blocks an oversized reservation without spending or splitting the remaining duration", async () => {
  const grant = grantStub("duration-insufficient");
  await grant.initialize(grantId("duration-insufficient"), CREATED_AT_MS, EXPIRES_AT_MS);
  await grant.setDurationAllowance(2_000, CREATED_AT_MS);
  const accepted = await grant.startConversion(
    "https://example.com/oversized",
    crypto.randomUUID(),
    CREATED_AT_MS,
  );
  if (accepted.result !== "created") throw new Error("Conversion not accepted");
  expect((await grant.reserveAudioSegment(accepted.conversion.conversionId, 0, 30)).result).toBe(
    "insufficient-duration",
  );
  expect((await grant.inspect(CREATED_AT_MS)).duration).toEqual({
    availableMilliseconds: 2_000,
    reservedMilliseconds: 0,
    spentMilliseconds: 0,
  });
});

test("retries reuse reservations, failures release only unfinished work, and replay never charges twice", async () => {
  const grant = grantStub("duration-failure");
  await grant.initialize(grantId("duration-failure"), CREATED_AT_MS, EXPIRES_AT_MS);
  const accepted = await grant.startConversion(
    "https://example.com/failure",
    crypto.randomUUID(),
    CREATED_AT_MS,
  );
  if (accepted.result !== "created") throw new Error("Conversion not accepted");
  const id = accepted.conversion.conversionId;
  await grant.reserveAudioSegment(id, 0, 10);
  await grant.reserveAudioSegment(id, 1, 10);
  expect((await grant.reserveAudioSegment(id, 0, 10)).result).toBe("reserved");
  expect((await grant.inspect(CREATED_AT_MS)).duration.reservedMilliseconds).toBe(2_000);
  await grant.completeAudioSegment(id, 0, 700.25);
  await grant.recordFailed(id, {
    failureCategory: "narration-synthesis",
    explanation: "Second segment failed.",
  });
  expect((await grant.inspect(CREATED_AT_MS)).duration).toEqual({
    availableMilliseconds: 7_199_299,
    reservedMilliseconds: 0,
    spentMilliseconds: 701,
  });
  expect((await grant.completeAudioSegment(id, 0, 700.25)).result).toBe("replayed");
  await expectWorkerRpcRejection(grant.completeAudioSegment(id, 0, 800));
  await expectWorkerRpcRejection(grant.completeAudioSegment(id, 1, 800));
  expect(await grant.listAudioSegments(id)).toHaveLength(1);
  expect(await grant.migrate()).toBe(6);
  expect((await grant.inspect(CREATED_AT_MS)).duration.spentMilliseconds).toBe(701);
});

test("revocation blocks new reservations while existing reservations may finish", async () => {
  const grant = grantStub("duration-revoked");
  await grant.initialize(grantId("duration-revoked"), CREATED_AT_MS, EXPIRES_AT_MS);
  const accepted = await grant.startConversion(
    "https://example.com/revoked",
    crypto.randomUUID(),
    CREATED_AT_MS,
  );
  if (accepted.result !== "created") throw new Error("Conversion not accepted");
  const id = accepted.conversion.conversionId;
  await grant.reserveAudioSegment(id, 0, 10);
  await grant.revoke(CREATED_AT_MS);
  expect((await grant.reserveAudioSegment(id, 0, 10)).result).toBe("reserved");
  expect((await grant.reserveAudioSegment(id, 1, 10)).result).toBe("revoked");
  expect((await grant.completeAudioSegment(id, 0, 800)).result).toBe("recorded");
  expect((await grant.inspect(CREATED_AT_MS)).duration.spentMilliseconds).toBe(800);
});

test("unused receipt columns do not affect existing conversion replay or duration accounting", async () => {
  const name = "unused-receipt-column";
  const grant = grantStub(name);
  await grant.initialize(grantId(name), CREATED_AT_MS, EXPIRES_AT_MS);
  await grant.setDurationAllowance(20_000, CREATED_AT_MS);
  const key = crypto.randomUUID();
  const accepted = await grant.startConversion("https://example.com/retained", key, CREATED_AT_MS);
  if (accepted.result !== "created") throw new Error("Conversion not accepted");
  const storage = await worker.getDurableObjectStorage("CONVERSION_GRANTS", { name });
  await storage.exec("ALTER TABLE conversions ADD COLUMN import_receipt_hash TEXT");
  await storage.exec("UPDATE conversions SET import_receipt_hash = ?", "a".repeat(64));
  await grant.reserveAudioSegment(accepted.conversion.conversionId, 0, 10);
  await grant.completeAudioSegment(accepted.conversion.conversionId, 0, 800);
  const before = await grant.inspect(CREATED_AT_MS);
  expect(await grant.migrate()).toBe(6);
  expect((await grant.inspect(CREATED_AT_MS)).duration).toEqual(before.duration);
  expect(await grant.listAudioSegments(accepted.conversion.conversionId)).toMatchObject([
    { actualMilliseconds: 800, chargedMilliseconds: 800 },
  ]);
  expect(
    (await grant.startConversion("https://example.com/retained", key, CREATED_AT_MS)).result,
  ).toBe("replayed");
  expect(await grant.migrate()).toBe(6);
});

test.each([false, true])(
  "upgrades production grants once while preserving credentials (revoked: %s)",
  async (revoked) => {
    const name = `production-grant-${revoked}`;
    const grant = grantStub(name);
    await grant.initialize(grantId(name), CREATED_AT_MS, EXPIRES_AT_MS);
    await grant.setDurationAllowance(20_000, CREATED_AT_MS);
    const root = await createRootCredential();
    await grant.installCredentialVerifier(root.verifier, CREATED_AT_MS);
    const session = await grant.exchangeCredential(root.credential, CREATED_AT_MS);
    if (session.result !== "created") throw new Error("Session not created");
    const accepted = await grant.startConversion(
      "https://example.com/old",
      crypto.randomUUID(),
      CREATED_AT_MS,
    );
    if (accepted.result !== "created") throw new Error("Conversion not accepted");
    await grant.reserveAudioSegment(accepted.conversion.conversionId, 0, 10);
    await grant.completeAudioSegment(accepted.conversion.conversionId, 0, 800);
    await grant.reserveAudioSegment(accepted.conversion.conversionId, 1, 10);
    if (revoked) await grant.revoke(CREATED_AT_MS);
    const storage = await worker.getDurableObjectStorage("CONVERSION_GRANTS", { name });
    const before = await storage.exec("SELECT * FROM grant");
    await installProductionSchema(storage, "grant", [
      "grant",
      "conversions",
      "segment_usage",
      "start_attempts",
    ]);

    await grant.migrate();
    expect(await storage.exec("SELECT * FROM grant")).toEqual(
      before.map((row) => ({
        ...row,
        projection_revision: Number(row["projection_revision"]) + 1,
      })),
    );
    expect(await grant.listConversions()).toEqual([]);
    expect(await storage.exec("SELECT * FROM segment_usage")).toEqual([]);
    expect(await storage.exec("SELECT * FROM start_attempts")).toEqual([]);
    expect((await grant.inspect(CREATED_AT_MS)).duration).toEqual({
      availableMilliseconds: 20_000,
      spentMilliseconds: 0,
      reservedMilliseconds: 0,
    });
    expect((await grant.inspect(CREATED_AT_MS)).state).toBe(revoked ? "revoked" : "open");
    expect((await grant.exchangeCredential(root.credential, CREATED_AT_MS)).result).toBe(
      revoked ? "grant-revoked" : "created",
    );
    expect((await grant.validateSession(session.sessionToken, CREATED_AT_MS)).result).toBe("valid");
    expect((await grant.inspect(EXPIRES_AT_MS)).state).toBe(revoked ? "revoked" : "expired");
    if (!revoked) {
      const next = await grant.startConversion(
        "https://example.com/new",
        crypto.randomUUID(),
        CREATED_AT_MS,
      );
      if (next.result !== "created") throw new Error("New conversion not accepted");
      await grant.reserveAudioSegment(next.conversion.conversionId, 0, 10);
      await grant.completeAudioSegment(next.conversion.conversionId, 0, 900);
    }
    await grant.migrate();
    expect(await grant.listConversions()).toHaveLength(revoked ? 0 : 1);
    expect((await grant.inspect(CREATED_AT_MS)).duration.spentMilliseconds).toBe(revoked ? 0 : 900);
    expect(await storage.exec("SELECT * FROM __drizzle_migrations")).toHaveLength(1);
  },
);

test("upgrades production registry inventory and drops old audiobook ownership", async () => {
  const name = "production-registry";
  const registry = registryStub(name);
  const entries = [];
  for (const label of ["Open", "Revoked", "Provisioning"]) {
    const { entry } = await registry.reserveProvisioning(crypto.randomUUID(), label, CREATED_AT_MS);
    if (label !== "Provisioning")
      await registry.activate(
        entry.requestId,
        {
          grantId: entry.grantId,
          revision: 10,
          allowanceMilliseconds: 20_000,
          spentMilliseconds: 800,
          reservedMilliseconds: 1000,
          schemaVersion: 5,
          ...(label === "Revoked" ? { revokedAtMs: CREATED_AT_MS } : {}),
        },
        true,
      );
    await registry.bindConversion(crypto.randomUUID(), entry.grantId);
    entries.push(entry);
  }
  const storage = await worker.getDurableObjectStorage("REGISTRY", { name });
  const before = await storage.exec("SELECT * FROM registry_grants ORDER BY grant_id");
  await storage.exec(
    "CREATE TABLE conversion_grants AS SELECT conversion_id, grant_id FROM conversion_owners WHERE owner_kind = 'trial'",
  );
  for (const table of [
    "conversion_owners",
    "identity_accounts",
    "provisioning_jobs",
    "deletion_jobs",
    "deletion_notifications",
    "canceled_deletion_attempts",
    "deletion_receipts",
    "rate_events",
  ])
    await storage.exec(`DROP TABLE ${table}`);
  await installProductionSchema(storage, "grant-registry", [
    "registry_grants",
    "conversion_grants",
  ]);
  await storage.exec("CREATE TABLE migration_failure (value TEXT)");
  await storage.exec(
    "CREATE UNIQUE INDEX identity_accounts_account_id_unique ON migration_failure(value)",
  );
  await expectWorkerRpcRejection(registry.migrate());
  expect(await storage.exec("SELECT * FROM registry_grants ORDER BY grant_id")).toEqual(before);
  expect(await storage.exec("SELECT * FROM _schema_migrations")).toHaveLength(1);
  expect(
    await storage.exec("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'"),
  ).toEqual([]);
  await storage.exec("DROP TABLE migration_failure");

  await registry.migrate();
  expect(await storage.exec("SELECT * FROM registry_grants ORDER BY grant_id")).toEqual(
    before.map((row) => ({
      ...row,
      projection_revision:
        row["projection_revision"] === null ? null : Number(row["projection_revision"]) + 1,
      projection_reserved: row["projection_revision"] === null ? null : 0,
      projection_spent: row["projection_revision"] === null ? null : 0,
      projection_schema_version: row["projection_revision"] === null ? null : 6,
    })),
  );
  expect(
    await storage.exec("SELECT name FROM sqlite_master WHERE name = 'conversion_grants'"),
  ).toEqual([]);
  expect(await storage.exec("SELECT * FROM conversion_owners")).toEqual([]);
  expect(await registry.findConversionOwner(crypto.randomUUID())).toBeUndefined();
  for (const entry of entries) {
    expect((await registry.reserveProvisioning(entry.requestId, entry.label)).created).toBe(false);
  }
  for (const entry of entries.filter((item) => item.label !== "Provisioning")) {
    expect(
      await registry.applyGrantRegistrySnapshot({
        grantId: entry.grantId,
        revision: 11,
        allowanceMilliseconds: 20_000,
        spentMilliseconds: 0,
        reservedMilliseconds: 0,
        schemaVersion: 6,
        ...(entry.label === "Revoked" ? { revokedAtMs: CREATED_AT_MS } : {}),
      }),
    ).toBe("replayed");
  }
  const first = entries[0];
  if (first === undefined) throw new Error("Missing grant");
  const newConversion = crypto.randomUUID();
  await registry.bindConversion(newConversion, first.grantId);
  await registry.migrate();
  expect(await registry.findConversionOwner(newConversion)).toEqual({
    kind: "trial",
    grantId: first.grantId,
  });
});

test("a failed production reset rolls back old tables and can be retried", async () => {
  const name = "production-rollback";
  const grant = grantStub(name);
  await grant.initialize(grantId(name), CREATED_AT_MS, EXPIRES_AT_MS);
  await grant.startConversion("https://example.com/old", crypto.randomUUID(), CREATED_AT_MS);
  const storage = await worker.getDurableObjectStorage("CONVERSION_GRANTS", { name });
  await installProductionSchema(storage, "grant", [
    "grant",
    "conversions",
    "segment_usage",
    "start_attempts",
  ]);
  const before = await storage.exec("SELECT * FROM grant");
  await storage.exec("CREATE TABLE migration_failure (value TEXT)");
  await storage.exec("CREATE UNIQUE INDEX grant_grant_id_unique ON migration_failure(value)");
  await expectWorkerRpcRejection(grant.migrate());
  expect(await storage.exec("SELECT * FROM grant")).toEqual(before);
  expect(await storage.exec("SELECT * FROM conversions")).toHaveLength(1);
  expect(await storage.exec("SELECT * FROM _schema_migrations")).toHaveLength(1);
  expect(
    await storage.exec("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'"),
  ).toEqual([]);
  await storage.exec("DROP TABLE migration_failure");
  await grant.migrate();
  expect(await grant.listConversions()).toEqual([]);
});

async function installProductionSchema(
  storage: Awaited<ReturnType<typeof worker.getDurableObjectStorage>>,
  store: "grant" | "grant-registry",
  tables: string[],
) {
  const rows = new Map<string, Record<string, string | number | null>[]>();
  for (const table of tables) rows.set(table, await storage.exec(`SELECT * FROM ${table}`));
  for (const table of tables.toReversed()) await storage.exec(`DROP TABLE ${table}`);
  await storage.exec("DROP TABLE __drizzle_migrations");
  const fixture = await fs.readFile(
    new URL(`./fixtures/production-${store}.sql`, import.meta.url),
    "utf8",
  );
  for (const statement of fixture.split("--> statement-breakpoint")) await storage.exec(statement);
  for (const [table, records] of rows)
    for (const row of records)
      await storage.exec(
        `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row)
          .map(() => "?")
          .join(", ")})`,
        ...Object.values(row),
      );
}
