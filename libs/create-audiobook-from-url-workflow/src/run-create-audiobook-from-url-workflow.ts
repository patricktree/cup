import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import pMap from "p-map";
import { Temporal } from "temporal-polyfill";

import {
  assembleAudiobook,
  SPEECH_CONFIG,
  getStoredSpeechConfig,
  createAudioSegmentKey,
  PermanentNarrationSynthesisError,
  produceAudioSegment,
  storeAudiobook,
  type AudioSegmentReference,
  type SpeechSynthesisAi,
} from "@cup/audiobook-production";
import {
  ConversionPhase,
  type ConversionFailureCategory,
  type ConversionGrantDurableObject,
} from "@cup/conversion-grants";
import type {
  NarrationContentSelectionResult,
  SelectionChunkRunner,
} from "@cup/narration-content-selection";
import { createNarrationDocument } from "@cup/narration-document-creation";
import type { SourceMaterialPreparer } from "@cup/prepare-source-material";

import { conversionParamsSchema, type ConversionParams } from "#src/conversion-params.ts";

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

const NARRATION_SYNTHESIS_STEP_CONFIG = {
  retries: {
    limit: 2,
    delay: "5 seconds",
    backoff: "exponential",
  },
  timeout: "2 minutes",
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

const SEGMENT_CONCURRENCY = 8;
const MAX_NARRATION_TEXT_CHARACTERS = 40_000;
const MAX_NARRATION_CHUNKS = 200;

export type CreateAudiobookFromUrlWorkflowServices = {
  prepareSourceMaterial: SourceMaterialPreparer;
  selectNarrationContent(
    sourceMaterialHtml: string,
    options: { conversionId: string; runChunk: SelectionChunkRunner },
  ): Promise<NarrationContentSelectionResult>;
  speechSynthesisAi: SpeechSynthesisAi;
};

export type CreateAudiobookFromUrlWorkflowEnvironment = {
  AUDIO_BUCKET: R2Bucket;
  CONVERSION_GRANTS: DurableObjectNamespace<ConversionGrantDurableObject>;
};

export type { ConversionParams };

/** Runs a conversion through durable steps using explicitly supplied provider services. */
export async function runCreateAudiobookFromUrlWorkflow({
  env,
  event,
  step,
  services,
}: {
  env: CreateAudiobookFromUrlWorkflowEnvironment;
  event: WorkflowEvent<ConversionParams>;
  step: WorkflowStep;
  services: CreateAudiobookFromUrlWorkflowServices;
}) {
  const { sourceUrl, grantId } = conversionParamsSchema.parse(event.payload);
  const conversionId = event.instanceId;
  let stage: ConversionFailureCategory = "source-preparation";

  const result = await (async () => {
    try {
      const sourceMaterial = await step.do(
        "prepare audiobook source material",
        PREPARE_STEP_CONFIG,
        async () => {
          await recordPhaseStarted(
            env,
            grantId,
            conversionId,
            ConversionPhase.SOURCE_MATERIAL_PREPARATION,
          );
          return services.prepareSourceMaterial(sourceUrl);
        },
      );

      stage = "content-selection";
      await step.do("start narration content selection", PROCESSING_STEP_CONFIG, () =>
        recordPhaseStarted(env, grantId, conversionId, ConversionPhase.NARRATION_CONTENT_SELECTION),
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
          await recordPhaseStarted(
            env,
            grantId,
            conversionId,
            ConversionPhase.NARRATION_DOCUMENT_CREATION,
          );
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

      stage = "narration-synthesis";
      const speechConfig = await step.do(
        "choose narration synthesis configuration",
        PROCESSING_STEP_CONFIG,
        async () => {
          // Retain the original provider when resuming a conversion started before this step existed.
          const firstSegment = await env.AUDIO_BUCKET.head(createAudioSegmentKey(conversionId, 0));
          return firstSegment ? getStoredSpeechConfig(firstSegment) : SPEECH_CONFIG;
        },
      );
      const audioSegments: AudioSegmentReference[] = await pMap(
        synchronizationUnits,
        ({ narrationText }, chunkIndex) =>
          step.do(
            `produce audio segment ${chunkIndex + 1}`,
            NARRATION_SYNTHESIS_STEP_CONFIG,
            async ({ attempt }) => {
              if (chunkIndex === 0)
                await recordPhaseStarted(
                  env,
                  grantId,
                  conversionId,
                  ConversionPhase.AUDIO_SEGMENT_PRODUCTION,
                );
              try {
                return await produceAudioSegment({
                  ai: services.speechSynthesisAi,
                  speechConfig,
                  bucket: env.AUDIO_BUCKET,
                  conversionId,
                  sequence: chunkIndex,
                  narrationChunk: { text: narrationText },
                  synthesisAttempt: attempt,
                  synthesisResponseMode: attempt === 1 ? "streaming" : "non-streaming",
                });
              } catch (error) {
                if (error instanceof PermanentNarrationSynthesisError) {
                  throw new NonRetryableError(error.message, error.name);
                }

                throw error;
              }
            },
          ),
        { concurrency: SEGMENT_CONCURRENCY },
      );

      stage = "audiobook-assembly";
      const audiobookAudio = await step.do(
        "assemble audiobook audio",
        PROCESSING_STEP_CONFIG,
        async () => {
          await recordPhaseStarted(env, grantId, conversionId, ConversionPhase.AUDIOBOOK_ASSEMBLY);
          return assembleAudiobook({
            bucket: env.AUDIO_BUCKET,
            conversionId,
            audioSegments,
          });
        },
      );

      const audiobookReference = await step.do(
        "store audiobook",
        PROCESSING_STEP_CONFIG,
        async () => {
          await recordPhaseStarted(env, grantId, conversionId, ConversionPhase.AUDIOBOOK_STORAGE);
          return storeAudiobook({
            bucket: env.AUDIO_BUCKET,
            conversionId,
            title: sourceMaterial.title,
            originalUrl: sourceUrl,
            narrationDocument,
            audio: audiobookAudio,
            audioSegments,
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
            audioDurationMilliseconds: audiobookAudio.durationMilliseconds,
          },
          providerUsage: {
            contentSelection: contentSelectionUsage,
            narrationSynthesisRequests: synchronizationUnits.length,
            narrationSynthesisCharacters: narrationTextCharacters,
          },
        },
      };
    } catch (error) {
      const failedOutcome = await step.do(
        "create failed conversion outcome",
        PROCESSING_STEP_CONFIG,
        async () => {
          await recordPhaseStarted(env, grantId, conversionId, ConversionPhase.FINALIZATION);
          return {
            failureCategory: stage,
            explanation:
              error instanceof ContentLimitError
                ? "The source content exceeds the narration limit of 40,000 characters or 200 chunks."
                : "The conversion could not be completed.",
            diagnosticReference: crypto.randomUUID(),
            cleanupState: "pending" as const,
            completedAtMs: Temporal.Now.instant().epochMilliseconds,
          };
        },
      );

      await step.do("record conversion failure", TERMINAL_STATE_STEP_CONFIG, () =>
        getGrantStub(env, grantId).recordFailed(conversionId, failedOutcome),
      );
      throw error;
    }
  })();

  const readyOutcome = await step.do(
    "create ready conversion outcome",
    PROCESSING_STEP_CONFIG,
    async () => {
      await recordPhaseStarted(env, grantId, conversionId, ConversionPhase.FINALIZATION);
      return {
        ...result.readyOutcome,
        completedAtMs: Temporal.Now.instant().epochMilliseconds,
      };
    },
  );

  await step.do("record conversion ready", TERMINAL_STATE_STEP_CONFIG, () =>
    getGrantStub(env, grantId).recordReady(conversionId, readyOutcome),
  );

  return result.audiobookReference;
}

class ContentLimitError extends Error {
  constructor() {
    super("Narration exceeds the conversion content ceiling");
    this.name = "ContentLimitError";
  }
}

function getGrantStub(env: CreateAudiobookFromUrlWorkflowEnvironment, grantId: string) {
  return env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(grantId));
}

async function recordPhaseStarted(
  env: CreateAudiobookFromUrlWorkflowEnvironment,
  grantId: string,
  conversionId: string,
  phase: ConversionPhase,
): Promise<void> {
  await getGrantStub(env, grantId).recordPhaseStarted(conversionId, phase);
}
