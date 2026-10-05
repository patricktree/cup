import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { accountArtifactBucket } from "@cup/accounts/artifact-writer";
import {
  loadAudiobook,
  produceAudioSegment,
  PermanentNarrationSynthesisError,
  type SpeechSynthesisAi,
} from "@cup/audiobook-production";
import {
  createConversionArtifactPrefix,
  segmentWorkflowParamsSchema,
  type SegmentWorkflowParams,
} from "@cup/conversion-contracts";

import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

/** One stable Workflow identity serializes synthesis and retries for a unit across all players. */
export async function runAudioSegmentWorkflow({
  env,
  event,
  step,
  ai,
}: {
  env: AudiobookWorkflowEnvironment;
  event: WorkflowEvent<SegmentWorkflowParams>;
  step: WorkflowStep;
  ai: SpeechSynthesisAi;
}) {
  const params = segmentWorkflowParamsSchema.parse(event.payload);
  const { conversionId, owner, sequence, executionEpoch } = params;
  if (event.instanceId !== `segment-${conversionId}-${sequence}`)
    throw new NonRetryableError("Segment Workflow identity mismatch");

  const account =
    owner.kind === "account"
      ? env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner.accountId))
      : undefined;
  const grant =
    owner.kind === "trial"
      ? env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(owner.grantId))
      : undefined;
  const prefix = createConversionArtifactPrefix(conversionId, owner);
  const bucket = account
    ? accountArtifactBucket(env.AUDIO_BUCKET, account, executionEpoch, prefix)
    : env.AUDIO_BUCKET;
  const audiobook = await step.do("load prepared narration", async () => {
    const reference = account ? (await account.getConversion(conversionId))?.outcome : undefined;
    const manifest =
      reference?.status === "ready"
        ? reference.audiobookReference
        : await grant?.getReadyAudiobookReference(conversionId);
    if (!manifest || manifest.key !== `${prefix}audiobook.json`)
      throw new NonRetryableError("Prepared narration is unavailable");
    return loadAudiobook({ bucket, audiobookReference: manifest });
  });
  const unit = audiobook.narrationDocument.synchronizationUnits[sequence];
  if (!unit) throw new NonRetryableError("Synchronization unit does not exist");

  try {
    return await step.do(
      "synthesize and settle audio segment",
      {
        retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
        timeout: "2 minutes",
      },
      async ({ attempt }) => {
        const reservation = account
          ? await account.reserveAudioSegment(
              conversionId,
              sequence,
              unit.narrationText.length,
              executionEpoch,
            )
          : await grant!.reserveAudioSegment(conversionId, sequence, unit.narrationText.length);
        if (reservation.result !== "reserved" && reservation.result !== "settled")
          throw new NonRetryableError(
            "There is not enough available audio duration, or the trial no longer permits new speech generation.",
          );
        try {
          const segment = await produceAudioSegment({
            ai,
            bucket,
            conversionId,
            artifactPrefix: prefix,
            sequence,
            narrationChunk: { text: unit.narrationText },
            speechConfig: audiobook.speechConfig,
            synthesisAttempt: attempt,
            synthesisResponseMode: attempt === 1 ? "streaming" : "non-streaming",
          });
          if (account)
            await account.completeAudioSegment(
              conversionId,
              sequence,
              segment.durationMilliseconds,
              executionEpoch,
            );
          else
            await grant!.completeAudioSegment(conversionId, sequence, segment.durationMilliseconds);
          return segment;
        } catch (error) {
          if (error instanceof PermanentNarrationSynthesisError)
            throw new NonRetryableError(error.message);
          throw error;
        }
      },
    );
  } catch (error) {
    await step.do("release failed segment reservation", async () => {
      if (account) await account.releaseAudioSegment(conversionId, sequence, executionEpoch);
      else await grant!.releaseAudioSegment(conversionId, sequence);
      await bucket.put(
        `${prefix}segment-${sequence}-failure.json`,
        JSON.stringify({
          explanation:
            error instanceof Error
              ? error.message
              : "Speech generation failed. Retry this passage.",
        }),
        { httpMetadata: { contentType: "application/json" } },
      );
    });
    throw error;
  }
}
