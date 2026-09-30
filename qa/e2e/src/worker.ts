import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import { createApiServer } from "@cup/api-server";
import {
  ConversionGrantDurableObject,
  ConversionGrantRegistryDurableObject,
} from "@cup/conversion-grants";
import {
  runCreateAudiobookFromUrlWorkflow,
  type ConversionParams,
} from "@cup/create-audiobook-from-url-workflow/runner";
import { createFakeNarrationContentSelector } from "@cup/narration-content-selection/fake";
import { createControlledSourceMaterialPreparer } from "@cup/prepare-source-material/fake";

import sourceHtml from "#src/fixtures/source.html";
import { createTrackedSpeechProvider, handleSpeechControl } from "#src/speech-controls.ts";

const CONTROLLED_SOURCE_URL = "https://source.example.test/fixture";

export { ConversionGrantDurableObject, ConversionGrantRegistryDurableObject };

/** Runs the production Workflow pipeline with deterministic local provider adapters. */
export class CreateAudiobookFromUrlQaWorkflow extends WorkflowEntrypoint<Env, ConversionParams> {
  override run(event: WorkflowEvent<ConversionParams>, step: WorkflowStep) {
    assertNoPaidAiBindings(this.env);
    const scenario = parseQaScenario(this.env.QA_SCENARIO);

    return runCreateAudiobookFromUrlWorkflow({
      env: this.env,
      event,
      step,
      services: {
        prepareSourceMaterial: createControlledSourceMaterialPreparer({
          url: CONTROLLED_SOURCE_URL,
          html: sourceHtml,
        }),
        selectNarrationContent: createFakeNarrationContentSelector(),
        speechSynthesisAi: createTrackedSpeechProvider(this.env.AUDIO_BUCKET, scenario),
      },
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

type QaScenario = "success" | "tts-failure" | "speech-gated";

function parseQaScenario(value: string): QaScenario {
  if (value === "success" || value === "tts-failure" || value === "speech-gated") {
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
