import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { Temporal } from "temporal-polyfill";

import { SPEECH_CONFIG, storeAudiobook } from "@cup/audiobook-production";
import { ConversionPhase, type ConversionFailureCategory } from "@cup/conversion-contracts";
import { conversionParamsSchema, type ConversionParams } from "@cup/conversion-contracts";
import type {
  NarrationContentSelectionResult,
  SelectionChunkRunner,
} from "@cup/narration-content-selection";
import { createNarrationDocument } from "@cup/narration-document-creation";
import type { SourceMaterialPreparer } from "@cup/prepare-source-material";

import { resolveConversionExecution } from "#src/conversion-execution.ts";
import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

const PREPARE_STEP_CONFIG = {
  retries: {
    limit: 2,
    delay: "10 seconds",
    backoff: "exponential",
  },
  timeout: "10 minutes",
} as const satisfies WorkflowStepConfig;

const AI_STEP_CONFIG = {
  retries: {
    limit: 2,
    delay: "10 seconds",
    backoff: "exponential",
  },
  timeout: "3 minutes",
} as const satisfies WorkflowStepConfig;

const PROCESSING_STEP_CONFIG = {
  retries: {
    limit: 0,
    delay: 0,
  },
  timeout: "10 minutes",
} as const satisfies WorkflowStepConfig;

const TERMINAL_STATE_STEP_CONFIG = {
  retries: {
    limit: 2,
    delay: "5 seconds",
    backoff: "exponential",
  },
  timeout: "1 minute",
} as const satisfies WorkflowStepConfig;

const MAX_NARRATION_TEXT_CHARACTERS = 40_000;
const MAX_NARRATION_CHUNKS = 200;

export type PrepareAudiobookWorkflowServices = {
  prepareSourceMaterial: SourceMaterialPreparer;
  selectNarrationContent(
    sourceMaterialHtml: string,
    options: { conversionId: string; runChunk: SelectionChunkRunner },
  ): Promise<NarrationContentSelectionResult>;
};

export type { ConversionParams };

/** Runs a conversion through durable steps using explicitly supplied provider services. */
export async function runPrepareAudiobookWorkflow({
  env,
  event,
  step,
  services,
}: {
  env: AudiobookWorkflowEnvironment;
  event: WorkflowEvent<ConversionParams>;
  step: WorkflowStep;
  services: PrepareAudiobookWorkflowServices;
}) {
  const params = conversionParamsSchema.parse(event.payload);
  const { sourceUrl } = params;
  if ("v" in params && params.conversionId !== event.instanceId)
    throw new NonRetryableError("Workflow conversion identity mismatch");
  const owner = "v" in params ? params.owner : { kind: "trial" as const, grantId: params.grantId };
  const conversionId = event.instanceId;
  const execution = resolveConversionExecution(env, {
    conversionId,
    owner,
    executionEpoch: "v" in params ? params.executionEpoch : 1,
  });
  const { artifactPrefix, artifactBucket: bucket } = execution;
  let stage: ConversionFailureCategory = "source-preparation";

  const result = await (async () => {
    try {
      const sourceMaterial = await step.do(
        "prepare audiobook source material",
        PREPARE_STEP_CONFIG,
        async () => {
          await execution.phaseStarted(ConversionPhase.SOURCE_MATERIAL_PREPARATION);
          return services.prepareSourceMaterial(sourceUrl);
        },
      );

      stage = "content-selection";
      await step.do("start narration content selection", PROCESSING_STEP_CONFIG, () =>
        execution.phaseStarted(ConversionPhase.NARRATION_CONTENT_SELECTION),
      );
      const { selectedSourceMaterialHtml, usage: contentSelectionUsage } =
        await services.selectNarrationContent(sourceMaterial.html, {
          conversionId,
          runChunk: (chunkIndex, select) =>
            step.do(`select narration content chunk ${chunkIndex + 1}`, AI_STEP_CONFIG, select),
        });

      const narrationDocument = await step.do(
        "create narration document",
        PROCESSING_STEP_CONFIG,
        async () => {
          await execution.phaseStarted(ConversionPhase.NARRATION_DOCUMENT_CREATION);
          return createNarrationDocument({
            sourceTitle: sourceMaterial.title,
            sourceMaterialHtml: selectedSourceMaterialHtml,
          });
        },
      );
      const { synchronizationUnits } = narrationDocument;
      const narrationTextCharacters = synchronizationUnits.reduce(
        (total, unit) => total + unit.narrationText.length,
        0,
      );
      if (
        narrationTextCharacters > MAX_NARRATION_TEXT_CHARACTERS ||
        synchronizationUnits.length > MAX_NARRATION_CHUNKS
      ) {
        stage = "content-limit";
        throw new ContentLimitError();
      }

      const audiobookReference = await step.do(
        "store audiobook",
        PROCESSING_STEP_CONFIG,
        async () => {
          await execution.phaseStarted(ConversionPhase.AUDIOBOOK_STORAGE);
          return storeAudiobook({
            bucket,
            conversionId,
            artifactPrefix,
            title: sourceMaterial.title,
            originalUrl: sourceUrl,
            narrationDocument,
            speechConfig: SPEECH_CONFIG,
          });
        },
      );

      return {
        audiobookReference,
        readyOutcome: {
          title: sourceMaterial.title,
          audiobookReference,
          measurements: {
            narrationTextCharacters,
            narrationChunks: synchronizationUnits.length,
          },
          providerUsage: {
            contentSelection: contentSelectionUsage,
          },
        },
      };
    } catch (error) {
      const failedOutcome = await step.do(
        "create failed conversion outcome",
        PROCESSING_STEP_CONFIG,
        async () => {
          await execution.phaseStarted(ConversionPhase.FINALIZATION);
          return {
            failureCategory: stage,
            explanation:
              error instanceof ContentLimitError
                ? "The source content exceeds the narration limit of 40,000 characters or 200 chunks."
                : "Preparation failed. Try again to prepare this article.",
            diagnosticReference: crypto.randomUUID(),
            cleanupState: "pending" as const,
            completedAtMs: Temporal.Now.instant().epochMilliseconds,
          };
        },
      );

      await step.do("record conversion failure", TERMINAL_STATE_STEP_CONFIG, async () => {
        await execution.recordFailed(failedOutcome);
      });
      throw error;
    }
  })();

  const readyOutcome = await step.do(
    "create ready conversion outcome",
    PROCESSING_STEP_CONFIG,
    async () => {
      await execution.phaseStarted(ConversionPhase.FINALIZATION);
      return {
        ...result.readyOutcome,
        completedAtMs: Temporal.Now.instant().epochMilliseconds,
      };
    },
  );

  await step.do("record conversion ready", TERMINAL_STATE_STEP_CONFIG, async () => {
    await execution.recordReady(readyOutcome);
  });

  return result.audiobookReference;
}

class ContentLimitError extends Error {
  constructor() {
    super("Narration exceeds the conversion content ceiling");
    this.name = "ContentLimitError";
  }
}
