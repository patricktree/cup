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

import { runPrepareAudiobookWorkflow } from "#src/run-prepare-audiobook-workflow.ts";
import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

const SOURCE_URL = "https://example.com/provider-failure";
const ALLOWANCE = 7_200_000;
const harness = createTestHarness({
  root: path.resolve(import.meta.dirname, ".."),
  workers: [{ configPath: "./wrangler.test.jsonc" }],
});
const worker = harness.getWorker<AudiobookWorkflowEnvironment>();
let environment: AudiobookWorkflowEnvironment;

beforeAll(async () => {
  await harness.listen();
  environment = await worker.getEnv();
}, 30_000);
afterAll(() => harness.close());

import { runAudioSegmentWorkflow } from "#src/run-audio-segment-workflow.ts";

test("preparation publishes the document without invoking speech or reserving allowance", async () => {
  const { grant, grantId, conversionId, now } = await createConversion();
  await runConversion(grantId, conversionId);
  expect((await grant.getConversion(conversionId))?.status).toBe("ready");
  expect((await grant.inspect(now)).duration.reservedMilliseconds).toBe(0);
  const artifacts = await environment.AUDIO_BUCKET.list({
    prefix: "conversions/" + conversionId + "/",
  });
  expect(artifacts.objects.map((object) => object.key)).toEqual([
    "conversions/" + conversionId + "/audiobook.json",
  ]);
});

test.each([400, 503])(
  "failed unit synthesis (%i) leaves prepared text and releases only its reservation",
  async (status) => {
    const { grant, grantId, conversionId, now } = await createConversion();
    await runConversion(grantId, conversionId);
    await expect(
      runSegment(
        conversionId,
        { kind: "trial", grantId },
        0,
        createFakeSpeechSynthesisAi({ failureStatus: status }),
      ),
    ).rejects.toThrow("Configured deterministic speech failure");
    expect((await grant.getConversion(conversionId))?.status).toBe("ready");
    expect((await grant.inspect(now)).duration).toEqual({
      availableMilliseconds: ALLOWANCE,
      reservedMilliseconds: 0,
      spentMilliseconds: 0,
    });
    // Explicit retry can reuse a released reservation and produce accessible audio once.
    await runSegment(conversionId, { kind: "trial", grantId }, 0, createFakeSpeechSynthesisAi());
    const before = (await grant.inspect(now)).duration;
    await runSegment(
      conversionId,
      { kind: "trial", grantId },
      0,
      createFakeSpeechSynthesisAi({ failureStatus: 503 }),
    );
    expect((await grant.inspect(now)).duration).toEqual(before);
  },
);

test("account segment retry preserves its ledger and earlier successful audio", async () => {
  const accountId = crypto.randomUUID();
  const account = environment.ACCOUNTS.get(environment.ACCOUNTS.idFromName(accountId));
  await account.initialize({
    accountId,
    subject: crypto.randomUUID(),
    createdAtMs: Temporal.Now.instant().epochMilliseconds,
  });
  const started = await account.startConversion({
    sourceUrl: SOURCE_URL,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!started.conversion) throw new Error("Expected conversion");
  const conversionId = started.conversion.conversionId;
  await runConversion(accountId, conversionId, accountId);
  await runSegment(conversionId, { kind: "account", accountId }, 0, createFakeSpeechSynthesisAi());
  const balance = (await account.inspect()).balance;
  await expect(
    runSegment(
      conversionId,
      { kind: "account", accountId },
      1,
      createFakeSpeechSynthesisAi({ failureStatus: 503 }),
    ),
  ).rejects.toThrow("Configured deterministic speech failure");
  expect((await account.inspect()).balance).toEqual(balance);
  await runSegment(conversionId, { kind: "account", accountId }, 1, createFakeSpeechSynthesisAi());
  expect(
    (await account.listAudioSegments(conversionId)).filter((item) => item.state === "settled"),
  ).toHaveLength(2);
  await expect(account.inspectAccounting()).resolves.toBeDefined();
});

function runSegment(
  conversionId: string,
  owner: { kind: "trial"; grantId: string } | { kind: "account"; accountId: string },
  sequence: number,
  ai: SpeechSynthesisAi,
) {
  return runAudioSegmentWorkflow({
    env: environment,
    ai,
    step: createImmediateRetryStep(),
    event: {
      workflowName: "segment-test",
      instanceId: "segment-" + conversionId + "-" + sequence,
      timestamp: new globalThis.Date(),
      payload: { v: 3, owner, conversionId, sequence, executionEpoch: 1 },
    },
  });
}

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

function runConversion(grantId: string, conversionId: string, accountId?: string) {
  return runPrepareAudiobookWorkflow({
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
