import http from "node:http";
import nodeUrl from "node:url";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestHarness } from "wrangler";

import type { AccountDurableObject } from "@cup/accounts";
import { accountArtifactBucket } from "@cup/accounts/artifact-writer";

import type { RegistryDurableObject } from "#src/index.ts";

import type { AccountDispatchTestDurableObject, DeletionTestDurableObject } from "#test/worker.ts";

type AccountEnvironment = {
  ACCOUNT_DISPATCH_TEST: DurableObjectNamespace<AccountDispatchTestDurableObject>;
  DELETION_TEST: DurableObjectNamespace<DeletionTestDurableObject>;
  AUDIO_BUCKET: R2Bucket;
  ACCOUNTS: DurableObjectNamespace<AccountDurableObject>;
  REGISTRY: DurableObjectNamespace<RegistryDurableObject>;
};
const harness = createTestHarness({
  root: nodeUrl.fileURLToPath(new URL("..", import.meta.url)),
  workers: [{ configPath: "./wrangler.test.jsonc" }],
});
const worker = harness.getWorker();
let bindings: AccountEnvironment;
// Wrangler masks rejected RPC error messages; rejection checks are paired with persisted-state assertions.
const nowMs = 2_000_000_000_000;

const missingIdentities = new Set<string>();
const identityProvider = http.createServer((request, response) => {
  const subject = request.url?.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/)?.[1];
  if (!subject || missingIdentities.has(subject)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ id: subject }));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => identityProvider.listen(0, "127.0.0.1", resolve));
  const address = identityProvider.address();
  if (!address || typeof address === "string") throw new Error("Identity provider did not start");
  await harness.update({
    root: nodeUrl.fileURLToPath(new URL("..", import.meta.url)),
    workers: [
      {
        configPath: "./wrangler.test.jsonc",
        vars: { SUPABASE_URL: `http://127.0.0.1:${address.port}` },
        secrets: { SUPABASE_SECRET_KEY: "test-admin", RESEND_API_KEY: "test-resend" },
      },
    ],
  });
  await harness.listen();
  const environment: unknown = await worker.getEnv();
  if (!isAccountEnvironment(environment)) throw new Error("Account bindings unavailable");
  bindings = environment;
}, 30_000);

afterAll(async () => {
  await harness.close();
  await new Promise<void>((resolve, reject) =>
    identityProvider.close((error) => (error ? reject(error) : resolve())),
  );
});

async function createAccount() {
  const accountId = crypto.randomUUID();
  const subject = crypto.randomUUID();
  const account = bindings.ACCOUNTS.get(bindings.ACCOUNTS.idFromName(accountId));
  await account.initialize({ accountId, subject, createdAtMs: nowMs });
  return { account, accountId, subject };
}

test("concurrent verified logins allocate one account and one welcome grant", async () => {
  const registry = bindings.REGISTRY.get(bindings.REGISTRY.idFromName("concurrent"));
  const subject = crypto.randomUUID();
  const snapshots = await Promise.all(
    Array.from({ length: 12 }, () => registry.provisionVerifiedIdentity(subject, nowMs)),
  );
  expect(new Set(snapshots.map((snapshot) => snapshot.accountId)).size).toBe(1);
  expect(snapshots.every((snapshot) => snapshot.balance.available === 1_800_000)).toBe(true);
  const accountId = snapshots[0]?.accountId;
  if (accountId === undefined) throw new Error("Expected provisioned account");
  const account = bindings.ACCOUNTS.get(bindings.ACCOUNTS.idFromName(accountId));
  expect((await account.inspectAccounting()).entries).toBe(1);
  expect((await registry.findIdentity(subject))?.phase).toBe("active");
});

test("a missing provider identity cannot allocate an account", async () => {
  const registry = bindings.REGISTRY.get(bindings.REGISTRY.idFromName("missing-identity"));
  const subject = crypto.randomUUID();
  missingIdentities.add(subject);
  await expectWorkerRpcRejection(registry.provisionVerifiedIdentity(subject, nowMs));
  expect(await registry.findIdentity(subject)).toBeUndefined();
});

test("interrupted provisioning resumes the allocated account without granting twice", async () => {
  const registry = bindings.REGISTRY.get(bindings.REGISTRY.idFromName("interruption"));
  const subject = crypto.randomUUID();
  const allocation = await registry.reserveVerifiedIdentity(subject, nowMs);
  const account = bindings.ACCOUNTS.get(bindings.ACCOUNTS.idFromName(allocation.accountId));
  await account.initialize({ subject, accountId: allocation.accountId, createdAtMs: nowMs });
  const recovered = await registry.provisionVerifiedIdentity(subject, nowMs + 60_000);
  expect(recovered.accountId).toBe(allocation.accountId);
  expect(recovered.balance.available).toBe(1_800_000);
  expect((await account.inspectAccounting()).entries).toBe(1);
  await expectWorkerRpcRejection(
    account.initialize({ subject, accountId: allocation.accountId, createdAtMs: nowMs + 1 }),
  );
});

test("identity deletion fences provisioning against the old identity", async () => {
  const registry = bindings.REGISTRY.get(bindings.REGISTRY.idFromName("fence"));
  const subject = crypto.randomUUID();
  const allocation = await registry.reserveVerifiedIdentity(subject, nowMs);
  await registry.fenceIdentityDeletion(subject, allocation.accountId);
  await expectWorkerRpcRejection(registry.provisionVerifiedIdentity(subject, nowMs));
  expect((await registry.findIdentity(subject))?.accountId).toBe(allocation.accountId);
});

test("concurrent segment reservations cannot exceed the available duration", async () => {
  const { account } = await createAccount();
  const starts = await Promise.all(
    Array.from({ length: 10 }, () =>
      account.startConversion(
        { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
        nowMs,
      ),
    ),
  );
  const reservations = await Promise.all(
    starts.map((start) => {
      if (!start.conversion) throw new Error("Expected conversion");
      return account.reserveAudioSegment(start.conversion.conversionId, 0, 11_250, 1);
    }),
  );
  expect(reservations.filter((result) => result.result === "reserved")).toHaveLength(2);
  expect(reservations.filter((result) => result.result === "insufficient-duration")).toHaveLength(
    8,
  );
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: 0,
    reserved: 1_800_000,
  });
  expect(await account.pendingConversions()).toHaveLength(10);
  expect(await account.inspectAccounting()).toMatchObject({
    reconstructed: { available: 0, reserved: 1_800_000 },
    entries: 3,
  });
});

test("lost-response retries recover one conversion and reject conflicting content", async () => {
  const { account } = await createAccount();
  const input = { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" };
  const results = await Promise.all([
    account.startConversion(input, nowMs),
    account.startConversion(input, nowMs),
  ]);
  expect(results.map((result) => result.result).sort()).toEqual(["created", "replayed"]);
  expect(results[0]?.conversion?.conversionId).toBe(results[1]?.conversion?.conversionId);
  await expectWorkerRpcRejection(
    account.startConversion({ ...input, sourceUrl: "https://example.com/other" }, nowMs),
  );
  expect((await account.inspectAccounting()).entries).toBe(1);
});

test("failure releases once and a contradictory success cannot charge later", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    {
      idempotencyKey: crypto.randomUUID(),
      sourceUrl: "https://example.com/book",
    },
    nowMs,
  );
  const conversionId = started.conversion?.conversionId;
  if (conversionId === undefined) throw new Error("Expected conversion");
  await account.reserveAudioSegment(conversionId, 0, 100, 1);
  const failure = {
    status: "failed",
    failureCategory: "source-preparation",
    explanation: "Source unavailable",
  } as const;
  await Promise.all([
    account.settleConversion(conversionId, failure, nowMs),
    account.settleConversion(conversionId, failure, nowMs),
  ]);
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: 1_800_000,
    reserved: 0,
  });
  await expectWorkerRpcRejection(
    account.settleConversion(
      conversionId,
      {
        status: "ready",
        title: "Book",
        audiobookReference: {
          key: `accounts/${accountId}/conversions/${conversionId}/executions/1/audiobook.json`,
          contentType: "application/json",
          byteLength: 123,
          etag: "fixture",
        },
      },
      nowMs,
    ),
  );
  expect((await account.inspectAccounting()).entries).toBe(3);
});

test("successful settlement consumes once and rejects a foreign artifact prefix", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    {
      idempotencyKey: crypto.randomUUID(),
      sourceUrl: "https://example.com/book",
    },
    nowMs,
  );
  const conversionId = started.conversion?.conversionId;
  if (conversionId === undefined) throw new Error("Expected conversion");
  await account.reserveAudioSegment(conversionId, 0, 100, 1);
  await account.completeAudioSegment(conversionId, 0, 15_000, 1);
  const outcome = {
    status: "ready",
    title: "Book",
    audiobookReference: {
      key: `accounts/${accountId}/conversions/${conversionId}/executions/1/audiobook.json`,
      contentType: "application/json",
      byteLength: 123,
      etag: "fixture",
    },
  } as const;
  await expectWorkerRpcRejection(
    account.settleConversion(
      conversionId,
      {
        ...outcome,
        audiobookReference: {
          ...outcome.audiobookReference,
          key: "conversions/trial/audiobook.json",
        },
      },
      nowMs,
    ),
  );
  await Promise.all([
    account.settleConversion(conversionId, outcome, nowMs),
    account.settleConversion(conversionId, outcome, nowMs),
  ]);
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: 1_785_000,
    reserved: 0,
  });
  expect((await account.inspectAccounting()).entries).toBe(3);
});

test("invalid debits roll back operation and ledger while adjustments stay idempotent", async () => {
  const { account } = await createAccount();
  const requestId = crypto.randomUUID();
  await expectWorkerRpcRejection(
    account.adjustAllowance(requestId, -1_800_001, "correction", nowMs),
  );
  expect((await account.inspectAccounting()).entries).toBe(1);
  await account.adjustAllowance(requestId, 2, "correction", nowMs);
  await account.adjustAllowance(requestId, 2, "correction", nowMs);
  await expectWorkerRpcRejection(account.adjustAllowance(requestId, 3, "correction", nowMs));
  expect((await account.inspect()).balance.available).toBe(1_800_002);
  expect((await account.inspectAccounting()).entries).toBe(2);
});

test("blocked accounts deny new reservations and final deletion denies settlement", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    {
      idempotencyKey: crypto.randomUUID(),
      sourceUrl: "https://example.com/book",
    },
    nowMs,
  );
  const conversionId = started.conversion?.conversionId;
  if (conversionId === undefined) throw new Error("Expected conversion");
  const storage = await worker.getDurableObjectStorage("ACCOUNTS", { name: accountId });
  await storage.exec("UPDATE account SET state = 'deleting', execution_epoch = 2");
  await expectWorkerRpcRejection(
    account.startConversion(
      {
        idempotencyKey: crypto.randomUUID(),
        sourceUrl: "https://example.com/book",
      },
      nowMs,
    ),
  );
  await expectWorkerRpcRejection(
    account.settleConversion(
      conversionId,
      {
        status: "failed",
        failureCategory: "internal",
        explanation: "Stopped",
      },
      nowMs,
    ),
  );
  expect((await account.inspectAccounting()).entries).toBe(1);
});

test("ownership is immutable and account conversions never resolve through trial lookup", async () => {
  const registry = bindings.REGISTRY.get(bindings.REGISTRY.idFromName("ownership"));
  const conversionId = crypto.randomUUID();
  const owner = { kind: "account", accountId: crypto.randomUUID() } as const;
  await registry.bindConversionOwner(conversionId, owner);
  await registry.bindConversionOwner(conversionId, owner);
  expect(await registry.findConversionOwner(conversionId)).toEqual(owner);
  expect(await registry.findGrantIdForConversion(conversionId)).toBeUndefined();
  expect(await registry.findConversionOwner(crypto.randomUUID())).toBeUndefined();
  await expectWorkerRpcRejection(registry.bindConversion(conversionId, crypto.randomUUID()));
  await expectWorkerRpcRejection(
    registry.bindConversionOwner(conversionId, {
      kind: "account",
      accountId: crypto.randomUUID(),
    }),
  );
});

test("grant bindings remain trial-owned after replaying migrations", async () => {
  const registryName = "legacy-owner";
  const registry = bindings.REGISTRY.get(bindings.REGISTRY.idFromName(registryName));
  const { entry } = await registry.reserveProvisioning(crypto.randomUUID(), "Legacy", nowMs);
  const conversionId = crypto.randomUUID();
  await registry.bindConversion(conversionId, entry.grantId);
  await registry.bindConversion(conversionId, entry.grantId);
  const otherGrant = await registry.reserveProvisioning(crypto.randomUUID(), "Other", nowMs);
  await expectWorkerRpcRejection(registry.bindConversion(conversionId, otherGrant.entry.grantId));
  const unregisteredConversion = crypto.randomUUID();
  await expectWorkerRpcRejection(
    registry.bindConversion(unregisteredConversion, crypto.randomUUID()),
  );
  expect(await registry.findConversionOwner(unregisteredConversion)).toBeUndefined();
  const storage = await worker.getDurableObjectStorage("REGISTRY", {
    name: registryName,
  });
  expect(await storage.exec("SELECT * FROM __drizzle_migrations")).toHaveLength(1);
  expect(await registry.migrate()).toBe(4);
  expect(await registry.findConversionOwner(conversionId)).toEqual({
    kind: "trial",
    grantId: entry.grantId,
  });
  await expectWorkerRpcRejection(
    registry.bindConversionOwner(conversionId, {
      kind: "account",
      accountId: crypto.randomUUID(),
    }),
  );
  expect(await registry.findGrantIdForConversion(conversionId)).toBe(entry.grantId);
});

async function expectWorkerRpcRejection(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch {
    // Wrangler hides the original rejection behind its RPC transport; state assertions verify the effect.
    return;
  }
  throw new Error("Expected the Durable Object operation to reject");
}

function isAccountEnvironment(value: unknown): value is AccountEnvironment {
  return typeof value === "object" && value !== null && "ACCOUNTS" in value && "REGISTRY" in value;
}

test("obsolete execution cannot settle after an account execution epoch change", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected accepted conversion");
  await account.reserveAudioSegment(started.conversion.conversionId, 0, 100, 1);
  const storage = await worker.getDurableObjectStorage("ACCOUNTS", { name: accountId });
  await storage.exec("UPDATE account SET execution_epoch = 2, state = 'active'");
  await expectWorkerRpcRejection(
    account.settleConversion(
      started.conversion.conversionId,
      { status: "failed", failureCategory: "obsolete", explanation: "Obsolete execution" },
      nowMs,
      1,
    ),
  );
  expect((await account.inspect()).balance.reserved).toBe(8_000);
  expect((await account.inspectAccounting()).entries).toBe(2);
});

test("lost dispatch acknowledgement and exhausted terminal retries release the reserved duration", async () => {
  const accountId = crypto.randomUUID();
  const account = bindings.ACCOUNT_DISPATCH_TEST.get(
    bindings.ACCOUNT_DISPATCH_TEST.idFromName(accountId),
  );
  await account.initialize({ accountId, subject: crypto.randomUUID(), createdAtMs: nowMs });
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  await account.reserveAudioSegment(started.conversion.conversionId, 0, 100, 1);
  expect((await account.inspect()).balance.reserved).toBe(8_000);
  await account.reconcileForTest();
  await account.reconcileForTest();
  expect((await account.getConversion(started.conversion.conversionId))?.status).toBe("failed");
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: 1_800_000,
    reserved: 0,
  });
  expect((await account.inspectAccounting()).entries).toBe(3);
});

test("account history pages ties deterministically without crossing owners", async () => {
  const { account, accountId } = await createAccount();
  await account.adjustAllowance(crypto.randomUUID(), 60, "history test", nowMs);
  const accepted = [];
  for (let index = 0; index < 53; index++) {
    accepted.push(
      await account.startConversion(
        { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/" },
        nowMs + index * 60_001,
      ),
    );
  }
  const storage = await worker.getDurableObjectStorage("ACCOUNTS", { name: accountId });
  await storage.exec("UPDATE account_conversions SET created_at_ms = ?", nowMs);
  const first = await account.history();
  expect(first.items).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  const [createdAtMs, conversionId] = first.nextCursor!.split(":");
  if (!conversionId) throw new Error("Expected history cursor");
  const second = await account.history({ createdAtMs: Number(createdAtMs), conversionId });
  expect(second.items).toHaveLength(3);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((item) => item?.conversionId)).size).toBe(
    accepted.length,
  );
  const { account: other } = await createAccount();
  expect((await other.history()).items).toHaveLength(0);
});

test("unresolved storage effects block artifact writer drain", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const prefix = `accounts/${accountId}/conversions/${started.conversion.conversionId}/`;
  await account.registerArtifactWriter("writer", 1, prefix);
  await account.beginArtifactEffect("writer", "put:" + prefix + "audiobook.mp3");
  await expect(account.drainArtifactWriter("writer")).rejects.toThrow(/.+/);
  expect(await account.inspectArtifactWriters()).toHaveLength(1);
  await account.acknowledgeArtifactEffect("writer");
  await account.drainArtifactWriter("writer");
  expect(await account.inspectArtifactWriters()).toHaveLength(0);
});

test("ready conversions accept artifact writes", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const conversionId = started.conversion.conversionId;
  const prefix = `accounts/${accountId}/conversions/${conversionId}/executions/1/`;
  await account.settleConversion(
    conversionId,
    {
      status: "ready",
      title: "Book",
      audiobookReference: {
        key: prefix + "audiobook.json",
        contentType: "application/json",
        byteLength: 123,
        etag: "fixture",
      },
    },
    nowMs,
  );
  await account.registerArtifactWriter("speech", 1, prefix);
  await account.beginArtifactEffect("speech", "put:" + prefix + "segment-0.mp3");
  await account.acknowledgeArtifactEffect("speech");
  await account.drainArtifactWriter("speech");
  expect(await account.inspectArtifactWriters()).toHaveLength(0);
});

test("writer fences deny new effects after a deadline while allowing outstanding acknowledgement", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const prefix = `accounts/${accountId}/conversions/${started.conversion.conversionId}/`;
  await account.registerArtifactWriter("pending", 1, prefix);
  await account.beginArtifactEffect("pending", "put:audio");
  const storage = await worker.getDurableObjectStorage("ACCOUNTS", { name: accountId });
  await storage.exec(
    "UPDATE account SET state = 'deletion_scheduled', recovery_deadline_ms = 0 WHERE id = 1",
  );
  await expect(account.registerArtifactWriter("late", 1, prefix)).rejects.toThrow(/.+/);
  await account.acknowledgeArtifactEffect("pending");
  await expect(account.beginArtifactEffect("pending", "put:manifest")).rejects.toThrow(/.+/);
  await account.drainArtifactWriter("pending");
});

test("deletion needs fresh authentication and recovery preserves the original ledger", async () => {
  const { account } = await createAccount();
  const first = await account.deletionChallenge();
  await expect(
    account.scheduleDeletion({
      challengeId: first.challengeId,
      authenticatedAtSeconds: Math.floor(first.issuedAtMs / 1000),
      email: "user@example.com",
    }),
  ).resolves.toEqual({ result: "conflict" });
  expect((await account.inspect()).state).toBe("active");
  // The test account is initialized directly; registry delivery intentionally rejects it.
  await expect(
    account.scheduleDeletion({
      challengeId: first.challengeId,
      authenticatedAtSeconds: Math.floor(first.issuedAtMs / 1000) + 1,
      email: "user@example.com",
    }),
  ).rejects.toThrow(/.+/);
  const scheduled = await account.inspect();
  expect(scheduled.state).toBe("deletion_scheduled");
  expect(scheduled.recoveryDeadlineMs).not.toBeNull();
  await expect(
    account.startConversion({
      idempotencyKey: crypto.randomUUID(),
      sourceUrl: "https://example.com/article",
    }),
  ).rejects.toThrow(/.+/);
  const recovery = await account.deletionChallenge();
  await expect(
    account.restoreAccount(recovery.challengeId, Math.floor(recovery.issuedAtMs / 1000) + 1),
  ).rejects.toThrow(/.+/);
  expect((await account.inspect()).state).toBe("active");
  expect((await account.inspectAccounting()).entries).toBe(1);
  await expect(
    account.restoreAccount(recovery.challengeId, Math.floor(recovery.issuedAtMs / 1000) + 1),
  ).resolves.toEqual({ result: "conflict" });
});

test("due deletion and email work cannot be starved by 100 future or terminal records", async () => {
  const name = crypto.randomUUID();
  const testObject = bindings.DELETION_TEST.get(bindings.DELETION_TEST.idFromName(name));
  await testObject.reconcileForTest();
  const storage = await worker.getDurableObjectStorage("DELETION_TEST", { name });
  const now = Temporal.Now.instant().epochMilliseconds;
  const accountId = crypto.randomUUID();
  for (let index = 0; index < 102; index++) {
    const attemptId = crypto.randomUUID();
    const due = index >= 100;
    const payload = {
      attemptId,
      accountId,
      subject: crypto.randomUUID(),
      email: "test@example.com",
      scheduledAtMs: now - 1000,
      deadlineMs: due ? now - 1 : now + 86400000,
      state: due ? "deleting" : "scheduled",
      identityDone: false,
      accountDone: true,
      failures: 0,
      nextAttemptMs: due ? now - 1 : now + 86400000,
    };
    await storage.exec(
      "INSERT INTO deletion_jobs VALUES (?, ?)",
      attemptId,
      JSON.stringify(payload),
    );
    await storage.exec(
      "INSERT INTO deletion_notifications VALUES (?, ?, ?)",
      attemptId + ":scheduled",
      attemptId,
      JSON.stringify({
        key: attemptId + ":scheduled",
        email: "test@example.com",
        subject: "Test",
        text: "Test",
        firstAttemptMs: null,
        nextAttemptMs: now - 1,
        attempts: 0,
        state: due ? "pending" : "sent",
      }),
    );
  }
  const receipts = await testObject.reconcileForTest();
  expect(receipts).toHaveLength(2);
});

test("confirmed ordinary storage effects reconcile after lost acknowledgment, including a deletion fence", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const prefix = "accounts/" + accountId + "/conversions/" + started.conversion.conversionId + "/";
  const writerId = crypto.randomUUID();
  const key = prefix + "audio.mp3";
  await account.registerArtifactWriter(writerId, 1, prefix);
  await account.beginArtifactEffect(writerId, "put:" + key);
  expect(await account.reconcileArtifactWriter(writerId)).toBe(false);
  await bindings.AUDIO_BUCKET.put(key, "audio", { customMetadata: { "cup-writer-id": writerId } });
  const storage = await worker.getDurableObjectStorage("ACCOUNTS", { name: accountId });
  await storage.exec("UPDATE account SET state = 'deleting', execution_epoch = 2");
  expect(await account.reconcileArtifactWriter(writerId)).toBe(true);
  expect(await account.inspectArtifactWriters()).toHaveLength(0);
  expect(await account.reconcileArtifactWriter(writerId)).toBe(true);
});

test("streamed artifact replay drains the producer after a lost write acknowledgment", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const prefix = "accounts/" + accountId + "/conversions/" + started.conversion.conversionId + "/";
  const key = prefix + "audiobook.mp3";
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("1:" + key)),
  );
  const writerId = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await account.prepareArtifactWrite(writerId, 1, prefix, key);
  expect((await account.inspectArtifactWriters())[0]?.effect).toBe("put:" + key);
  await bindings.AUDIO_BUCKET.put(key, "stored", { customMetadata: { "cup-writer-id": writerId } });
  const bucket = accountArtifactBucket(bindings.AUDIO_BUCKET, account, 1, prefix);
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const producer = stream.writable.getWriter();
  const upload = bucket.put(key, stream.readable);
  await producer.write(new TextEncoder().encode("replayed"));
  await producer.close();
  expect((await upload)?.size).toBe(6);
  expect(await account.inspectArtifactWriters()).toHaveLength(0);
});

test("a rejected concurrent streamed write cancels its producer instead of hanging", async () => {
  const { account, accountId } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const prefix = `accounts/${accountId}/conversions/${started.conversion.conversionId}/`;
  const key = prefix + "audiobook.mp3";
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("1:" + key)),
  );
  const writerId = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await account.prepareArtifactWrite(writerId, 1, prefix, key);
  const bucket = accountArtifactBucket(bindings.AUDIO_BUCKET, account, 1, prefix);
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const producer = stream.writable.getWriter();
  const upload = bucket.put(key, stream.readable).then(
    () => "stored",
    () => "rejected",
  );
  const written = producer.write(new Uint8Array([1])).then(
    () => "written",
    () => "canceled",
  );
  expect(await written).toBe("canceled");
  expect(await upload).toBe("rejected");
  expect(await account.inspectArtifactWriters()).toHaveLength(1);
});

test("final erasure waits for an in-flight upload and preserves original trials and a new account", async () => {
  const { account, accountId, subject } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const prefix = `accounts/${accountId}/conversions/${started.conversion.conversionId}/`;
  const writerId = crypto.randomUUID();
  const key = prefix + "audiobook.mp3";
  await account.prepareArtifactWrite(writerId, 1, prefix, key);

  const storage = await worker.getDurableObjectStorage("ACCOUNTS", { name: accountId });
  const attemptId = crypto.randomUUID();
  await storage.exec(
    "INSERT INTO deletion_attempts VALUES (?, ?, 'scheduled', 1)",
    attemptId,
    JSON.stringify({
      attemptId,
      accountId,
      subject,
      email: "",
      scheduledAtMs: 0,
      deadlineMs: 0,
      state: "scheduled",
    }),
  );
  await storage.exec("UPDATE account SET state = 'deletion_scheduled', recovery_deadline_ms = 0");
  await account.fenceDeletion(attemptId);
  await expect(account.eraseAccount(attemptId)).rejects.toThrow(/.+/);
  expect(
    await bindings.AUDIO_BUCKET.put(key, "private", {
      customMetadata: { "cup-writer-id": writerId },
    }),
  ).not.toBeNull();
  expect(await account.reconcileArtifactWriter(writerId)).toBe(true);
  const originalKey = `conversions/${crypto.randomUUID()}/audiobook.mp3`;
  await bindings.AUDIO_BUCKET.put(originalKey, "original");
  const replacement = await createAccount();
  const replacementKey = `accounts/${replacement.accountId}/test`;
  await bindings.AUDIO_BUCKET.put(replacementKey, "replacement");
  await account.eraseAccount(attemptId);
  await account.eraseAccount(attemptId);
  expect(
    (await bindings.AUDIO_BUCKET.list({ prefix: `accounts/${accountId}/` })).objects,
  ).toHaveLength(0);
  expect(await bindings.AUDIO_BUCKET.head(originalKey)).not.toBeNull();
  expect(await bindings.AUDIO_BUCKET.head(replacementKey)).not.toBeNull();
  expect((await replacement.account.inspect()).balance.available).toBe(1_800_000);
  expect(await storage.exec("SELECT * FROM artifact_writers")).toEqual([]);
});

test("email retries honor HTTP-date delay, keep the original window, purge terminal payloads and expire receipts", async () => {
  const name = crypto.randomUUID();
  const coordinator = bindings.DELETION_TEST.get(bindings.DELETION_TEST.idFromName(name));
  await coordinator.reconcileForTest();
  const storage = await worker.getDurableObjectStorage("DELETION_TEST", { name });
  const now = Temporal.Now.instant().epochMilliseconds;
  const first = now - 20 * 3600000;
  const retryDate = Temporal.Instant.fromEpochMilliseconds(now + 4 * 3600000).toZonedDateTimeISO(
    "UTC",
  );
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][retryDate.month - 1];
  const dateHeader =
    "Wed, " +
    String(retryDate.day).padStart(2, "0") +
    " " +
    month +
    " " +
    retryDate.year +
    " " +
    retryDate.toPlainTime().toString({ smallestUnit: "second" }) +
    " GMT";
  await coordinator.configureProviderForTest(429, dateHeader);
  const attemptId = crypto.randomUUID();
  const key = attemptId + ":scheduled";
  await storage.exec(
    "INSERT INTO deletion_notifications VALUES (?, ?, ?)",
    key,
    attemptId,
    JSON.stringify({
      key,
      email: "test@example.com",
      subject: "Immutable subject",
      text: "Immutable body",
      firstAttemptMs: first,
      nextAttemptMs: now - 1,
      attempts: 1,
      state: "pending",
    }),
  );
  await coordinator.reconcileForTest();
  const rows = await storage.exec(
    "SELECT json_extract(payload_json, '$.nextAttemptMs') AS next, json_extract(payload_json, '$.firstAttemptMs') AS first FROM deletion_notifications WHERE notification_key = ?",
    key,
  );
  expect(rows).toEqual([{ next: first + 23 * 3600000, first }]);
  expect(await coordinator.requestsForTest()).toBe(1);
  await storage.exec(
    "UPDATE deletion_notifications SET payload_json = json_set(payload_json, '$.firstAttemptMs', ?, '$.nextAttemptMs', 0) WHERE notification_key = ?",
    now - 24 * 3600000,
    key,
  );
  await coordinator.reconcileForTest();
  expect(await coordinator.requestsForTest()).toBe(1);
  expect(
    await storage.exec(
      "SELECT json_extract(payload_json, '$.state') AS state, json_extract(payload_json, '$.email') AS email, json_extract(payload_json, '$.text') AS text FROM deletion_notifications WHERE notification_key = ?",
      key,
    ),
  ).toEqual([{ state: "expired", email: "", text: "" }]);
  await storage.exec("INSERT INTO deletion_receipts VALUES (?, 0, 0, '{}')", attemptId);
  expect(await coordinator.reconcileForTest()).toHaveLength(0);
});

test("account and IP rolling limits reject without charging or extending the cooldown", async () => {
  const { account } = await createAccount();
  await account.adjustAllowance(crypto.randomUUID(), 20, "test allowance", nowMs);
  for (let index = 0; index < 10; index++) {
    expect(
      (
        await account.startConversion(
          { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/" + index },
          nowMs,
        )
      ).result,
    ).toBe("created");
  }
  const key = crypto.randomUUID();
  const input = { idempotencyKey: key, sourceUrl: "https://example.com/eleventh" };
  const balance = (await account.inspect()).balance;
  expect((await account.startConversion(input, nowMs + 1000)).retryAfter).toBe(59);
  expect((await account.startConversion(input, nowMs + 2000)).retryAfter).toBe(58);
  expect((await account.inspect()).balance).toEqual(balance);
  expect((await account.startConversion(input, nowMs + 60000)).result).toBe("created");
  expect((await account.startConversion(input, nowMs + 60001)).result).toBe("replayed");
  const registry = bindings.REGISTRY.get(bindings.REGISTRY.idFromName(crypto.randomUUID()));
  const hash = "a".repeat(64);
  const limited = await Promise.all(
    Array.from({ length: 61 }, () => registry.consumeIngressRequest(hash)),
  );
  expect(limited.filter((result) => result === 0)).toHaveLength(60);
  expect(limited.filter((result) => result > 0)).toHaveLength(1);
});

test("segment overruns cap charges at the allowance without invalidating other reservations", async () => {
  const { account } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/overrun" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const id = started.conversion.conversionId;
  await account.reserveAudioSegment(id, 0, 11_250, 1);
  await account.reserveAudioSegment(id, 1, 11_250, 1);
  await account.completeAudioSegment(id, 0, 2_000_000, 1);
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: 0,
    reserved: 900_000,
  });
  await account.completeAudioSegment(id, 1, 2_000_000, 1);
  await account.completeAudioSegment(id, 1, 2_000_000, 1);
  const usage = await account.listAudioSegments(id);
  expect(usage.map((segment) => segment.chargedMilliseconds)).toEqual([1_800_000, 0]);
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: 0,
    reserved: 0,
  });
  expect((await account.inspectAccounting()).entries).toBe(5);
  await expectWorkerRpcRejection(account.completeAudioSegment(id, 1, 2_000_001, 1));
  expect(
    (
      await account.startConversion(
        { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/next" },
        nowMs,
      )
    ).result,
  ).toBe("created");
});

test("failed generation retains completed duration charges and releases only unfinished segments", async () => {
  const { account } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/partial" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const id = started.conversion.conversionId;
  await account.reserveAudioSegment(id, 0, 100, 1);
  await account.reserveAudioSegment(id, 1, 100, 1);
  await account.completeAudioSegment(id, 0, 5_000.1, 1);
  const failure = {
    status: "failed",
    failureCategory: "narration-synthesis",
    explanation: "Provider failure",
  } as const;
  await account.settleConversion(id, failure, nowMs);
  await account.settleConversion(id, failure, nowMs);
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: 1_794_999,
    reserved: 0,
  });
  expect((await account.listAudioSegments(id)).map((item) => item.state)).toEqual([
    "settled",
    "released",
  ]);
  expect((await account.inspectAccounting()).entries).toBe(5);
  await expectWorkerRpcRejection(account.completeAudioSegment(id, 1, 1_000, 1));
});

test("reservation retries preserve the segment identity and reject conflicting narration", async () => {
  const { account } = await createAccount();
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/replay" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const id = started.conversion.conversionId;
  expect(await account.reserveAudioSegment(id, 0, 100, 1)).toEqual({ result: "reserved" });
  expect(await account.reserveAudioSegment(id, 0, 100, 1)).toEqual({ result: "reserved" });
  await expectWorkerRpcRejection(account.reserveAudioSegment(id, 0, 101, 1));
  await expectWorkerRpcRejection(account.reserveAudioSegment(id, 1, 100, 2));
  expect((await account.inspect()).balance.reserved).toBe(8_000);
  expect((await account.inspectAccounting()).entries).toBe(2);
});

test("replaying the account baseline preserves history and grants the welcome allowance once", async () => {
  const accountId = crypto.randomUUID();
  const account = bindings.ACCOUNT_DISPATCH_TEST.get(
    bindings.ACCOUNT_DISPATCH_TEST.idFromName(accountId),
  );
  const identity = { accountId, subject: crypto.randomUUID(), createdAtMs: nowMs };
  await account.initialize(identity);
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/baseline" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const before = await account.getConversion(started.conversion.conversionId);
  const first = await account.migrateForTest();
  const second = await account.migrateForTest();
  expect(first.snapshot.balance).toEqual({
    unit: "audio-millisecond",
    available: 1_800_000,
    reserved: 0,
  });
  expect(first.accounting.entries).toBe(1);
  expect(second).toEqual(first);
  expect(await account.getConversion(started.conversion.conversionId)).toEqual(before);
  expect(await account.initialize(identity)).toEqual(first.snapshot);
});

test("migration replay preserves existing artifact effects and account data", async () => {
  const accountId = crypto.randomUUID();
  const account = bindings.ACCOUNT_DISPATCH_TEST.get(
    bindings.ACCOUNT_DISPATCH_TEST.idFromName(accountId),
  );
  await account.initialize({ accountId, subject: crypto.randomUUID(), createdAtMs: nowMs });
  const started = await account.startConversion(
    { idempotencyKey: crypto.randomUUID(), sourceUrl: "https://example.com/book" },
    nowMs,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const prefix = `accounts/${accountId}/conversions/${started.conversion.conversionId}/`;
  await account.prepareArtifactWrite("existing-writer", 1, prefix, prefix + "audiobook.mp3");
  const storage = await worker.getDurableObjectStorage("ACCOUNT_DISPATCH_TEST", {
    name: accountId,
  });
  await storage.exec(
    "ALTER TABLE artifact_writers ADD COLUMN uploads_json TEXT NOT NULL DEFAULT '[]'",
  );
  const before = await account.inspect();
  const writers = await account.inspectArtifactWriters();
  await account.migrateForTest();
  expect(await account.inspectArtifactWriters()).toEqual(writers);
  expect(await account.inspect()).toEqual(before);
  expect((await account.getConversion(started.conversion.conversionId))?.status).toBe("pending");
  await expect(account.drainArtifactWriter("existing-writer")).rejects.toThrow(/.+/);
  await account.acknowledgeArtifactEffect("existing-writer");
  await account.drainArtifactWriter("existing-writer");
  expect(await account.inspectArtifactWriters()).toEqual([]);
});

test("a balance constraint failure rolls back the entire allowance adjustment", async () => {
  const { account } = await createAccount();
  const before = await account.inspectAccounting();
  const requestId = crypto.randomUUID();
  await expectWorkerRpcRejection(
    account.adjustAllowance(requestId, Number.MAX_SAFE_INTEGER, "overflow", nowMs),
  );
  expect(await account.inspectAccounting()).toEqual(before);
  // Reusing the request proves the failed transaction left no operation or ledger entry behind.
  await account.adjustAllowance(requestId, 100, "valid retry", nowMs);
  expect(await account.inspectAccounting()).toMatchObject({
    reconstructed: { available: 1_800_100, reserved: 0 },
    entries: 2,
  });
});

test("one registry preserves account provisioning and both owners across grant writes and migration replay", async () => {
  const registryName = crypto.randomUUID();
  const registry = bindings.REGISTRY.get(bindings.REGISTRY.idFromName(registryName));
  const subject = crypto.randomUUID();
  const account = await registry.provisionVerifiedIdentity(subject, nowMs);
  const accountConversion = crypto.randomUUID();
  const accountOwner = { kind: "account", accountId: account.accountId } as const;
  await registry.bindConversionOwner(accountConversion, accountOwner);

  const { entry } = await registry.reserveProvisioning(
    crypto.randomUUID(),
    "Shared registry",
    nowMs,
  );
  const trialConversion = crypto.randomUUID();
  await registry.bindConversion(trialConversion, entry.grantId);
  await registry.migrate();

  expect(await registry.findIdentity(subject)).toMatchObject({
    accountId: account.accountId,
    phase: "active",
  });
  expect(await registry.findConversionOwner(accountConversion)).toEqual(accountOwner);
  expect(await registry.findConversionOwner(trialConversion)).toEqual({
    kind: "trial",
    grantId: entry.grantId,
  });
  expect((await registry.listGrants({ limit: 10 }, nowMs)).grants).toHaveLength(1);

  const storage = await worker.getDurableObjectStorage("REGISTRY", { name: registryName });
  expect(await storage.exec("SELECT * FROM conversion_owners")).toHaveLength(2);
  expect(
    await storage.exec(
      "SELECT name FROM sqlite_master WHERE name IN ('conversion_routes', 'conversion_grants')",
    ),
  ).toEqual([]);

  await registry.removeAccountConversionOwners(account.accountId);
  expect(await registry.findConversionOwner(accountConversion)).toBeUndefined();
  expect(await registry.findConversionOwner(trialConversion)).toEqual({
    kind: "trial",
    grantId: entry.grantId,
  });
  expect((await registry.findIdentity(subject))?.accountId).toBe(account.accountId);
});
