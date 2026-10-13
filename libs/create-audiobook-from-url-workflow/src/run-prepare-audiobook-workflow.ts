import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { Temporal } from "temporal-polyfill";

import {
  countNarrationTextCharactersBySegment,
  SPEECH_CONFIG,
  storeAudiobook,
  storeCoverImage,
  type CoverImage,
  type CoverImageStorage,
} from "@cup/audiobook-production";
import { ConversionPhase, type ConversionFailureCategory } from "@cup/conversion-contracts";
import { conversionParamsSchema, type ConversionParams } from "@cup/conversion-contracts";
import type {
  NarrationContentSelectionResult,
  SelectionChunkRunner,
} from "@cup/narration-content-selection";
import { createNarrationDocument } from "@cup/narration-document-creation";
import type { CoverImageDeclaration, SourceMaterialPreparer } from "@cup/prepare-source-material";
import type { CoverImageLoader } from "@cup/prepare-source-material/cover-image";

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

// One retry covers a browser launch or connection that failed transiently; a refusal does not throw.
const COVER_IMAGE_STEP_CONFIG = {
  retries: {
    limit: 1,
    delay: "2 seconds",
  },
  timeout: "1 minute",
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
  loadCoverImage: CoverImageLoader;
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

  // Assigned once source preparation has finished; it never rejects.
  let coverImagePromise: Promise<CoverImage | undefined> | undefined;

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

      // Started beside content selection and awaited only before the manifest is stored, so a
      // slow image host does not delay selection.
      coverImagePromise = storeDeclaredCoverImage({
        artifactPrefix,
        bucket,
        conversionId,
        declaration: sourceMaterial.coverImage,
        loadCoverImage: services.loadCoverImage,
        sourceUrl,
        step,
      });

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

      const coverImage = await coverImagePromise;
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
            ...(coverImage === undefined ? {} : { coverImage }),
          });
        },
      );

      return {
        audiobookReference,
        narrationTextCharactersBySegment: countNarrationTextCharactersBySegment(narrationDocument),
        readyOutcome: {
          title: sourceMaterial.title,
          audiobookReference,
          ...(coverImage === undefined ? {} : { hasCoverImage: true as const }),
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
      // Let a cover image step that is still running finish first, so it cannot write into the
      // conversion's prefix after the owner has started cleaning up the failed conversion.
      await coverImagePromise;

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
    await execution.recordReady(readyOutcome, result.narrationTextCharactersBySegment);
  });

  // The ready outcome already reserved every segment or none. Insufficient duration is a valid
  // result that leaves nothing to dispatch; the owner's alarm dispatches if this step fails.
  await step.do("start speech synthesis", TERMINAL_STATE_STEP_CONFIG, async () => {
    await execution.startSynthesis(result.narrationTextCharactersBySegment);
  });

  return result.audiobookReference;
}

/**
 * Keeps the declared cover image when it can be loaded. Every failure leaves the audiobook without
 * one instead of failing the conversion, so this never rejects.
 */
async function storeDeclaredCoverImage({
  artifactPrefix,
  bucket,
  conversionId,
  declaration,
  loadCoverImage,
  sourceUrl,
  step,
}: {
  artifactPrefix: string;
  bucket: CoverImageStorage;
  conversionId: string;
  declaration: CoverImageDeclaration | undefined;
  loadCoverImage: CoverImageLoader;
  sourceUrl: string;
  step: WorkflowStep;
}): Promise<CoverImage | undefined> {
  if (declaration === undefined) return undefined;

  try {
    const outcome = await step.do("store cover image", COVER_IMAGE_STEP_CONFIG, async () => {
      const loaded = await loadCoverImage(declaration, sourceUrl);
      if (loaded.result === "refused") return loaded;

      // The bytes are stored inside the step because a step result cannot carry them.
      const coverImage = await storeCoverImage({
        artifactPrefix,
        bucket,
        bytes: loaded.bytes,
        contentType: loaded.contentType,
        conversionId,
        ...(declaration.alternativeText === undefined
          ? {}
          : { alternativeText: declaration.alternativeText }),
      });
      return { result: "stored" as const, coverImage };
    });
    if (outcome.result === "stored") return outcome.coverImage;

    logMissingCoverImage(conversionId, outcome.reason);
  } catch (error) {
    logMissingCoverImage(
      conversionId,
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
  }

  return undefined;
}

function logMissingCoverImage(conversionId: string, reason: string) {
  console.warn(JSON.stringify({ event: "cover-image-unavailable", conversionId, reason }));
}

class ContentLimitError extends Error {
  constructor() {
    super("Narration exceeds the conversion content ceiling");
    this.name = "ContentLimitError";
  }
}
