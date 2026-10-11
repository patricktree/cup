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

import type { AccountDurableObject } from "@cup/accounts";
import type { SpeechSynthesisAi } from "@cup/audiobook-production";
import { createFakeSpeechSynthesisAi } from "@cup/audiobook-production/fake";
import type { ConversionGrantDurableObject } from "@cup/conversion-grants";
import { createFakeNarrationContentSelector } from "@cup/narration-content-selection/fake";
import { createControlledSourceMaterialPreparer } from "@cup/prepare-source-material/fake";

import { runPrepareAudiobookWorkflow } from "#src/run-prepare-audiobook-workflow.ts";
import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

// The test Worker adds a hook to its owner classes that runs their alarm on demand.
type WithAlarmHook<Owner> = Owner & { reconcileForTest(): Promise<void> };
type TestEnvironment = Omit<AudiobookWorkflowEnvironment, "ACCOUNTS" | "CONVERSION_GRANTS"> & {
  ACCOUNTS: DurableObjectNamespace<WithAlarmHook<AccountDurableObject>>;
  CONVERSION_GRANTS: DurableObjectNamespace<WithAlarmHook<ConversionGrantDurableObject>>;
  SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW: Workflow;
};

const SOURCE_URL = "https://example.com/provider-failure";
const ALLOWANCE = 7_200_000;
const harness = createTestHarness({
  root: path.resolve(import.meta.dirname, ".."),
  workers: [{ configPath: "./wrangler.test.jsonc" }],
});
const worker = harness.getWorker<TestEnvironment>();
let environment: TestEnvironment;

beforeAll(async () => {
  await harness.listen();
  environment = await worker.getEnv();
}, 30_000);
afterAll(() => harness.close());

import { runAudioSegmentWorkflow } from "#src/run-audio-segment-workflow.ts";

test("preparation reserves duration for every segment of the document", async () => {
  const { grant, grantId, conversionId, now } = await createConversion();
  await runConversion(grantId, conversionId);
  expect((await grant.getConversion(conversionId))?.status).toBe("ready");
  const segments = await grant.listAudioSegments(conversionId);
  expect(segments.map((segment) => segment.state)).toEqual(["reserved", "reserved"]);
  expect((await grant.inspect(now)).duration.reservedMilliseconds).toBe(
    segments.reduce((total, segment) => total + segment.estimatedMilliseconds, 0),
  );
  const artifacts = await environment.AUDIO_BUCKET.list({
    prefix: "conversions/" + conversionId + "/",
  });
  expect(artifacts.objects.map((object) => object.key)).toEqual([
    "conversions/" + conversionId + "/audiobook.json",
  ]);
});

test.each(["trial", "account"] as const)(
  "a %s document is reserved with its ready outcome and the alarm dispatches what the workflow could not",
  async (kind) => {
    const { grant, grantId, conversionId: trialConversionId } = await createConversion();
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
    const conversionId = kind === "account" ? started.conversion.conversionId : trialConversionId;
    const owner = kind === "account" ? account : grant;

    // Stop the workflow right after it recorded the ready outcome, before it dispatches.
    const step = createImmediateRetryStep();
    const runStep = step.do.bind(step);
    step.do = ((name: string, ...rest: unknown[]) =>
      name === "start speech synthesis"
        ? Promise.reject(new Error("Dispatch unavailable"))
        : Reflect.apply(runStep, step, [name, ...rest])) as WorkflowStep["do"];
    await expect(
      runConversion(grantId, conversionId, kind === "account" ? accountId : undefined, false, step),
    ).rejects.toThrow("Dispatch unavailable");

    expect((await owner.listAudioSegments(conversionId)).map((segment) => segment.state)).toEqual([
      "reserved",
      "reserved",
    ]);
    const workflow = environment.SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW;
    await expect(workflow.get(`segment-${conversionId}-0`)).rejects.toBeInstanceOf(Error);

    await owner.reconcileForTest();
    for (const sequence of [0, 1])
      await expect(
        (await workflow.get(`segment-${conversionId}-${sequence}`)).status(),
      ).resolves.toBeDefined();
    // Dispatched work keeps its reservation until it settles or reports a failure.
    expect((await owner.listAudioSegments(conversionId)).map((segment) => segment.state)).toEqual([
      "reserved",
      "reserved",
    ]);
  },
);

test("a document exceeding the available duration reserves nothing", async () => {
  const { grant, grantId, conversionId, now } = await createConversion();
  // Enough for either segment alone, but not for the whole document.
  await grant.setDurationAllowance(2_500, now);
  await runConversion(grantId, conversionId);
  expect((await grant.getConversion(conversionId))?.status).toBe("ready");
  expect(await grant.listAudioSegments(conversionId)).toEqual([]);
  expect((await grant.inspect(now)).duration.reservedMilliseconds).toBe(0);
});

test("an account document exceeding the available duration reserves nothing until retried", async () => {
  const accountId = crypto.randomUUID();
  const account = environment.ACCOUNTS.get(environment.ACCOUNTS.idFromName(accountId));
  await account.initialize({
    accountId,
    subject: crypto.randomUUID(),
    createdAtMs: Temporal.Now.instant().epochMilliseconds,
  });
  const welcomeAllowance = (await account.inspect()).balance.available;
  // Leave enough for either segment alone, but not for the whole document.
  await account.adjustAllowance(crypto.randomUUID(), 2_500 - welcomeAllowance, "test");
  const started = await account.startConversion({
    sourceUrl: SOURCE_URL,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!started.conversion) throw new Error("Expected conversion");
  const conversionId = started.conversion.conversionId;

  await runConversion(accountId, conversionId, accountId);
  expect(await account.listAudioSegments(conversionId)).toEqual([]);
  expect((await account.inspect()).balance).toMatchObject({ available: 2_500, reserved: 0 });

  const narrationTextCharactersBySegment = [12, 32];
  await expect(
    account.startSynthesis(conversionId, narrationTextCharactersBySegment, 1),
  ).resolves.toEqual({
    result: "insufficient-duration",
    requiredMilliseconds: 3_560,
    availableMilliseconds: 2_500,
  });
  await account.adjustAllowance(crypto.randomUUID(), 10_000, "test");
  await expect(
    account.startSynthesis(conversionId, narrationTextCharactersBySegment, 1),
  ).resolves.toEqual({
    result: "started",
  });
  expect((await account.inspect()).balance).toMatchObject({ available: 8_940, reserved: 3_560 });
});

test.each([400, 503])(
  "failed unit synthesis (%i) leaves prepared text and releases only its reservation",
  async (status) => {
    const { grant, grantId, conversionId, now } = await createConversion();
    await runConversion(grantId, conversionId);
    const [failing, other] = await grant.listAudioSegments(conversionId);
    if (!failing || !other) throw new Error("Expected two reserved segments");
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
      availableMilliseconds: ALLOWANCE - other.estimatedMilliseconds,
      reservedMilliseconds: other.estimatedMilliseconds,
      spentMilliseconds: 0,
    });
    // A segment never reserves for itself: without the owner's retry it has nothing to spend.
    const ai = createFakeSpeechSynthesisAi();
    const gateway = vi.spyOn(ai, "gateway");
    await expect(runSegment(conversionId, { kind: "trial", grantId }, 0, ai)).rejects.toThrow(
      "no duration reservation",
    );
    expect(gateway).not.toHaveBeenCalled();
    // The owner's retry reserves the released segment again and it produces accessible audio once.
    await expect(
      grant.startSynthesis(conversionId, [
        failing.narrationTextCharacters,
        other.narrationTextCharacters,
      ]),
    ).resolves.toEqual({ result: "started" });
    await runSegment(conversionId, { kind: "trial", grantId }, 0, ai);
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

test("a rate-limited segment waits out the provider limit before failing", async () => {
  const { grant, grantId, conversionId } = await createConversion();
  await runConversion(grantId, conversionId);
  const sleep = vi.fn<WorkflowStep["sleep"]>().mockResolvedValue();
  const step = createImmediateRetryStep();
  step.sleep = sleep;

  await expect(
    runSegment(
      conversionId,
      { kind: "trial", grantId },
      0,
      createFakeSpeechSynthesisAi({ failureStatus: 429 }),
      1,
      step,
    ),
  ).rejects.toThrow("Configured deterministic speech failure");

  expect(sleep.mock.calls.map(([name]) => name)).toEqual([
    "wait for speech provider rate limit 1",
    "wait for speech provider rate limit 2",
    "wait for speech provider rate limit 3",
    "wait for speech provider rate limit 4",
  ]);
  expect((await grant.listAudioSegments(conversionId))[0]?.state).toBe("released");
});

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
  // Only the failed segment returns its reservation; the settled charge stays.
  expect((await account.inspect()).balance).toEqual({
    unit: "audio-millisecond",
    available: balance.available + balance.reserved,
    reserved: 0,
  });
  const segments = await account.listAudioSegments(conversionId);
  await account.startSynthesis(
    conversionId,
    segments.map((segment) => segment.narrationTextCharacters),
    1,
  );
  await runSegment(conversionId, { kind: "account", accountId }, 1, createFakeSpeechSynthesisAi());
  expect(
    (await account.listAudioSegments(conversionId)).filter((item) => item.state === "settled"),
  ).toHaveLength(2);
  const manifest = await environment.AUDIO_BUCKET.head(
    `accounts/${accountId}/conversions/${conversionId}/audiobook.json`,
  );
  const audio = await environment.AUDIO_BUCKET.head(
    `accounts/${accountId}/conversions/${conversionId}/audio-segments/0.mp3`,
  );
  const failure = await environment.AUDIO_BUCKET.head(
    `accounts/${accountId}/conversions/${conversionId}/segment-1-failure.json`,
  );
  for (const artifact of [manifest, audio, failure])
    expect(artifact?.customMetadata?.["cup-writer-id"]).toMatch(/^[a-f0-9]{64}$/);
  await expect(account.inspectAccounting()).resolves.toBeDefined();
});

test("a stale account execution epoch cannot reserve duration or publish segment artifacts", async () => {
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
  const balance = (await account.inspect()).balance;
  const ai = createFakeSpeechSynthesisAi();
  const gateway = vi.spyOn(ai, "gateway");

  // Wrangler's RPC transport can hide the original rejection; verify the storage effects below.
  await expect(
    runSegment(conversionId, { kind: "account", accountId }, 0, ai, 2),
  ).rejects.toBeInstanceOf(Error);

  expect(gateway).not.toHaveBeenCalled();
  expect((await account.inspect()).balance).toEqual(balance);
  expect((await account.listAudioSegments(conversionId)).map((segment) => segment.state)).toEqual([
    "reserved",
    "reserved",
  ]);
  const artifacts = await environment.AUDIO_BUCKET.list({
    prefix: `accounts/${accountId}/conversions/${conversionId}/`,
  });
  expect(artifacts.objects.map((object) => object.key)).toEqual([
    `accounts/${accountId}/conversions/${conversionId}/audiobook.json`,
  ]);
});

test.each(["trial", "account"] as const)(
  "%s preparation failures record the owning conversion's failure without reserving duration",
  async (kind) => {
    const { grant, grantId, conversionId: trialConversionId } = await createConversion();
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
    const conversionId = kind === "account" ? started.conversion.conversionId : trialConversionId;

    await expect(
      runConversion(grantId, conversionId, kind === "account" ? accountId : undefined, true),
    ).rejects.toThrow("Configured preparation failure");

    const conversion =
      kind === "account"
        ? (await account.getConversion(conversionId))?.outcome
        : await grant.getConversion(conversionId);
    expect(conversion).toMatchObject({
      status: "failed",
      failureCategory: "source-preparation",
      explanation: "Preparation failed. Try again to prepare this article.",
    });
    const segments =
      kind === "account"
        ? await account.listAudioSegments(conversionId)
        : await grant.listAudioSegments(conversionId);
    expect(segments).toEqual([]);
  },
);

function runSegment(
  conversionId: string,
  owner: { kind: "trial"; grantId: string } | { kind: "account"; accountId: string },
  sequence: number,
  ai: SpeechSynthesisAi,
  executionEpoch = 1,
  step = createImmediateRetryStep(),
) {
  return runAudioSegmentWorkflow({
    env: environment,
    ai,
    step,
    event: {
      workflowName: "segment-test",
      instanceId: "segment-" + conversionId + "-" + sequence,
      timestamp: new globalThis.Date(),
      payload: { v: 3, owner, conversionId, sequence, executionEpoch },
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

function runConversion(
  grantId: string,
  conversionId: string,
  accountId?: string,
  shouldFailPreparation = false,
  step = createImmediateRetryStep(),
) {
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
    step,
    services: {
      prepareSourceMaterial: shouldFailPreparation
        ? async () => {
            throw new Error("Configured preparation failure");
          }
        : createControlledSourceMaterialPreparer({
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
