import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { AccountDurableObject } from "@cup/accounts";
import { createApiServer } from "@cup/api-server";
import { type SegmentWorkflowParams } from "@cup/conversion-contracts";
import { ConversionGrantDurableObject } from "@cup/conversion-grants";
import {
  runPrepareAudiobookWorkflow,
  type ConversionParams,
} from "@cup/create-audiobook-from-url-workflow/runner";
import { runAudioSegmentWorkflow } from "@cup/create-audiobook-from-url-workflow/segment-runner";
import { createFakeNarrationContentSelector } from "@cup/narration-content-selection/fake";
import { createControlledSourceMaterialPreparer } from "@cup/prepare-source-material/fake";
import { RegistryDurableObject } from "@cup/registry";

import sourceHtml from "#src/fixtures/source.html";
import { createTrackedSpeechProvider, handleSpeechControl } from "#src/speech-controls.ts";

const CONTROLLED_SOURCE_URL = "https://source.example.test/fixture";

export { RegistryDurableObject, AccountDurableObject, ConversionGrantDurableObject };

/** Runs preparation with deterministic local provider adapters. */
export class PrepareAudiobookQaWorkflow extends WorkflowEntrypoint<Env, ConversionParams> {
  override run(event: WorkflowEvent<ConversionParams>, step: WorkflowStep) {
    assertNoPaidAiBindings(this.env);
    const scenario = parseQaScenario(this.env.QA_SCENARIO);

    return runPrepareAudiobookWorkflow({
      env: this.env,
      event: { ...event, payload: event.payload },
      step,
      services: {
        prepareSourceMaterial: createControlledSourceMaterialPreparer({
          url: CONTROLLED_SOURCE_URL,
          html: sourceHtml,
        }),
        selectNarrationContent: createFakeNarrationContentSelector(
          scenario === "preparation-failure"
            ? { failure: new NonRetryableError("Selection failed.") }
            : {},
        ),
      },
    });
  }
}

/** Runs segment synthesis with a tracked local speech provider. */
export class SynthesizeAudioSegmentQaWorkflow extends WorkflowEntrypoint<
  Env,
  SegmentWorkflowParams
> {
  override run(event: WorkflowEvent<SegmentWorkflowParams>, step: WorkflowStep) {
    assertNoPaidAiBindings(this.env);
    return runAudioSegmentWorkflow({
      env: this.env,
      event,
      step,
      ai: createTrackedSpeechProvider(this.env.AUDIO_BUCKET, parseQaScenario(this.env.QA_SCENARIO)),
    });
  }
}

const apiServer = createApiServer({
  validateOperatorAccess: (request) =>
    Promise.resolve(request.headers.get("Cf-Access-Token") === "local-access-token"),
});

export default {
  async fetch(request, env, context) {
    const control = await handleSpeechControl(request, env.AUDIO_BUCKET);
    return control ?? apiServer.fetch(request, env, context);
  },
} satisfies ExportedHandler<Env>;

type QaScenario = "success" | "tts-failure" | "speech-gated" | "preparation-failure";

function parseQaScenario(value: string): QaScenario {
  if (
    value === "success" ||
    value === "tts-failure" ||
    value === "speech-gated" ||
    value === "preparation-failure"
  ) {
    return value;
  }

  throw new Error(`Unknown QA scenario: ${value}`);
}

function assertNoPaidAiBindings(env: Env): void {
  const forbiddenBindings = ["AI", "CLOUDFLARE_API_KEY", "CLOUDFLARE_API_TOKEN"];
  const configuredBinding = forbiddenBindings.find((binding) => binding in env);

  if (configuredBinding !== undefined) {
    throw new Error(`Paid AI configuration is forbidden in E2E: ${configuredBinding}`);
  }
}
