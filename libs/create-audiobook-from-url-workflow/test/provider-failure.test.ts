import type {
  WorkflowStep,
  WorkflowStepContext,
  WorkflowStepRollbackOptions,
  WorkflowStepConfig,
} from "cloudflare:workers";
import path from "node:path";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createTestHarness } from "wrangler";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    readonly mocked = true;
  },
}));
vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class NonRetryableError extends Error {},
}));

import { NonRetryableError } from "cloudflare:workflows";

import type { SpeechSynthesisAi } from "@cup/audiobook-production";
import { createFakeSpeechSynthesisAi } from "@cup/audiobook-production/fake";
import { createFakeNarrationContentSelector } from "@cup/narration-content-selection/fake";
import { createControlledSourceMaterialPreparer } from "@cup/prepare-source-material/fake";

import {
  runCreateAudiobookFromUrlWorkflow,
  type CreateAudiobookFromUrlWorkflowEnvironment,
} from "#src/run-create-audiobook-from-url-workflow.ts";

const SOURCE_URL = "https://example.com/provider-failure";
const ALLOWANCE = 7_200_000;
const harness = createTestHarness({
  root: path.resolve(import.meta.dirname, ".."),
  workers: [{ configPath: "./wrangler.test.jsonc" }],
});
const worker = harness.getWorker<CreateAudiobookFromUrlWorkflowEnvironment>();
let environment: CreateAudiobookFromUrlWorkflowEnvironment;

beforeAll(async () => {
  await harness.listen();
  environment = await worker.getEnv();
}, 30_000);
afterAll(() => harness.close());

test.each([400, 503])(
  "provider status %i releases reservations without charging failed audio",
  async (status) => {
    const { grant, conversionId, grantId, now } = await createConversion();
    const reservedBalances: number[] = [];
    let calls = 0;
    const failingProvider = createFakeSpeechSynthesisAi({ failureStatus: status });
    const ai: SpeechSynthesisAi = {
      gateway: () => ({
        run: async (request, options) => {
          calls++;
          reservedBalances.push((await grant.inspect(now)).duration.reservedMilliseconds);
          return failingProvider.gateway("default").run(request, options);
        },
      }),
    };
    await expect(runConversion(grantId, conversionId, ai)).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("Configured deterministic speech failure"),
        }),
      ]),
    });
    expect(calls).toBe(status === 400 ? 2 : 6);
    expect(reservedBalances.every((balance) => balance > 0)).toBe(true);
    expect(Math.max(...reservedBalances)).toBe(
      1_000 + "A short paragraph for narration.".length * 80,
    );
    expect((await grant.inspect(now)).duration).toEqual({
      availableMilliseconds: ALLOWANCE,
      reservedMilliseconds: 0,
      spentMilliseconds: 0,
    });
    expect(await grant.getConversion(conversionId)).toMatchObject({
      status: "failed",
      failureCategory: "narration-synthesis",
    });
    expect(await grant.listAudioSegments(conversionId)).toEqual([]);
    expect(
      (await environment.AUDIO_BUCKET.list({ prefix: `conversions/${conversionId}/` })).objects,
    ).toEqual([]);
  },
);

test("later provider failure releases unfinished reservations and retains completed audio charges", async () => {
  const { grant, conversionId, grantId, now } = await createConversion();
  const successfulProvider = createFakeSpeechSynthesisAi();
  const failingProvider = createFakeSpeechSynthesisAi({ failureStatus: 503 });
  let successfulCalls = 0;
  let failedCalls = 0;
  const ai: SpeechSynthesisAi = {
    gateway: () => ({
      run: async (request, options) => {
        if (options?.gateway?.metadata?.["narrationSegmentSequence"] === 0) {
          successfulCalls++;
          return successfulProvider.gateway("default").run(request, options);
        }
        failedCalls++;
        return failingProvider.gateway("default").run(request, options);
      },
    }),
  };
  await expect(runConversion(grantId, conversionId, ai)).rejects.toMatchObject({
    errors: expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining("Configured deterministic speech failure"),
      }),
    ]),
  });
  expect(successfulCalls).toBe(1);
  expect(failedCalls).toBe(3);
  const segments = await grant.listAudioSegments(conversionId);
  expect(segments).toHaveLength(1);
  const completed = segments[0];
  if (completed === undefined) throw new Error("Completed audio missing");
  expect(completed.sequence).toBe(0);
  expect(completed.chargedMilliseconds).toBeGreaterThan(0);
  expect((await grant.inspect(now)).duration).toEqual({
    availableMilliseconds: ALLOWANCE - completed.chargedMilliseconds,
    reservedMilliseconds: 0,
    spentMilliseconds: completed.chargedMilliseconds,
  });
  expect(
    (await environment.AUDIO_BUCKET.list({ prefix: `conversions/${conversionId}/` })).objects,
  ).toHaveLength(1);
});

async function createConversion() {
  const grantId = crypto.randomUUID();
  const grant = environment.CONVERSION_GRANTS.get(
    environment.CONVERSION_GRANTS.idFromName(grantId),
  );
  const now = Temporal.Now.instant().epochMilliseconds;
  await grant.initialize(grantId, now, now + 86_400_000);
  const accepted = await grant.startConversion(SOURCE_URL, crypto.randomUUID(), now);
  if (accepted.result !== "created") throw new Error("Conversion not accepted");
  return { grant, grantId, conversionId: accepted.conversion.conversionId, now };
}

function runConversion(
  grantId: string,
  conversionId: string,
  ai: SpeechSynthesisAi,
  accountId?: string,
) {
  return runCreateAudiobookFromUrlWorkflow({
    env: environment,
    event: {
      workflowName: "provider-failure-test",
      instanceId: conversionId,
      payload: accountId
        ? {
            v: 2,
            owner: { kind: "account", accountId },
            conversionId,
            executionEpoch: 1,
            sourceUrl: SOURCE_URL,
          }
        : { grantId, sourceUrl: SOURCE_URL },
      timestamp: new globalThis.Date(Temporal.Now.instant().epochMilliseconds),
    },
    step: createImmediateRetryStep(),
    services: {
      prepareSourceMaterial: createControlledSourceMaterialPreparer({
        url: SOURCE_URL,
        html: "<article><h1>Failure test</h1><p>A short paragraph for narration.</p></article>",
      }),
      selectNarrationContent: createFakeNarrationContentSelector(),
      speechSynthesisAi: ai,
    },
  });
}

function createImmediateRetryStep(): WorkflowStep {
  // Execute the production retry count without the platform's wall-clock retry delays.
  return {
    do: doStep,
    sleep: vi.fn<WorkflowStep["sleep"]>().mockRejectedValue(new Error("Unexpected workflow sleep")),
    sleepUntil: vi
      .fn<WorkflowStep["sleepUntil"]>()
      .mockRejectedValue(new Error("Unexpected workflow sleep")),
    waitForEvent: async () => {
      throw new Error("Unexpected workflow event");
    },
  };
}

async function doStep<T>(
  name: string,
  configOrCallback: WorkflowStepConfig | ((context: WorkflowStepContext) => Promise<T>),
  configuredCallback?:
    | ((context: WorkflowStepContext) => Promise<T>)
    | WorkflowStepRollbackOptions<T>,
): Promise<T> {
  const config = typeof configOrCallback === "function" ? {} : configOrCallback;
  const callback = typeof configOrCallback === "function" ? configOrCallback : configuredCallback;
  if (typeof callback !== "function" || typeof config.retries?.delay === "function")
    throw new Error("Expected a configured workflow step");
  const attempts = (config.retries?.limit ?? 0) + 1;
  for (let attempt = 1; ; attempt++) {
    try {
      const context: WorkflowStepContext = { attempt, step: { name, count: 1 }, config: {} };
      return await callback(context);
    } catch (error) {
      if (error instanceof NonRetryableError || attempt >= attempts) throw error;
    }
  }
}

test.each([400, 503])(
  "account provider status %i releases estimated duration without spending minutes",
  async (status) => {
    const accountId = crypto.randomUUID();
    const account = environment.ACCOUNTS.get(environment.ACCOUNTS.idFromName(accountId));
    const now = Temporal.Now.instant().epochMilliseconds;
    await account.initialize({ accountId, subject: crypto.randomUUID(), createdAtMs: now });
    const started = await account.startConversion(
      { sourceUrl: SOURCE_URL, idempotencyKey: crypto.randomUUID() },
      now,
    );
    if (!started.conversion) throw new Error("Expected conversion");
    const failing = createFakeSpeechSynthesisAi({ failureStatus: status });
    const reserved: number[] = [];
    const ai: SpeechSynthesisAi = {
      gateway: () => ({
        run: async (request, options) => {
          reserved.push((await account.inspect()).balance.reserved);
          return failing.gateway("default").run(request, options);
        },
      }),
    };
    await expect(
      runConversion(accountId, started.conversion.conversionId, ai, accountId),
    ).rejects.toBeDefined();
    expect(reserved.every((amount) => amount > 0)).toBe(true);
    expect((await account.inspect()).balance).toEqual({
      unit: "audio-millisecond",
      available: 1_800_000,
      reserved: 0,
    });
    expect((await account.getConversion(started.conversion.conversionId))?.status).toBe("failed");
    expect((await account.inspectAccounting()).reconstructed).toEqual({
      available: 1_800_000,
      reserved: 0,
    });
  },
);

test("account provider failure after a completed segment retains that encoded duration charge", async () => {
  const accountId = crypto.randomUUID();
  const account = environment.ACCOUNTS.get(environment.ACCOUNTS.idFromName(accountId));
  const now = Temporal.Now.instant().epochMilliseconds;
  await account.initialize({ accountId, subject: crypto.randomUUID(), createdAtMs: now });
  const started = await account.startConversion(
    { sourceUrl: SOURCE_URL, idempotencyKey: crypto.randomUUID() },
    now,
  );
  if (!started.conversion) throw new Error("Expected conversion");
  const successful = createFakeSpeechSynthesisAi();
  const failing = createFakeSpeechSynthesisAi({ failureStatus: 503 });
  const ai: SpeechSynthesisAi = {
    gateway: () => ({
      run: (request, options) =>
        (options?.gateway?.metadata?.["narrationSegmentSequence"] === 0 ? successful : failing)
          .gateway("default")
          .run(request, options),
    }),
  };
  const conversionId = started.conversion.conversionId;
  await expect(runConversion(accountId, conversionId, ai, accountId)).rejects.toBeDefined();
  const segments = await account.listAudioSegments(conversionId);
  expect(segments.filter((item) => item.state === "settled")).toHaveLength(1);
  const spent = segments.reduce((sum, item) => sum + item.chargedMilliseconds, 0);
  expect(spent).toBeGreaterThan(0);
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: 1_800_000 - spent,
    reserved: 0,
  });
  expect((await account.inspectAccounting()).reconstructed).toEqual({
    available: 1_800_000 - spent,
    reserved: 0,
  });
});
