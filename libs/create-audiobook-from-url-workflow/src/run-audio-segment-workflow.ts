import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import {
  loadAudiobook,
  produceAudioSegment,
  PermanentNarrationSynthesisError,
  RateLimitedNarrationSynthesisError,
  type SpeechSynthesisAi,
} from "@cup/audiobook-production";
import { segmentWorkflowParamsSchema, type SegmentWorkflowParams } from "@cup/conversion-contracts";

import { resolveConversionExecution } from "#src/conversion-execution.ts";
import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

// The whole narration document is dispatched at once, so a burst can exceed the provider's
// per-minute limit. Waiting outlasts that window instead of failing the segment; see ADR 0008.
const RATE_LIMIT_WAIT = "30 seconds";
const MAX_RATE_LIMIT_WAITS = 4;

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
  const { conversionId, sequence } = params;
  if (event.instanceId !== `segment-${conversionId}-${sequence}`) {
    throw new NonRetryableError("Segment Workflow identity mismatch");
  }

  const execution = resolveConversionExecution(env, params);
  const { artifactPrefix: prefix, artifactBucket: bucket } = execution;
  const audiobook = await step.do("load prepared narration", async () => {
    const manifest = await execution.getReadyAudiobookReference();
    if (!manifest || manifest.key !== `${prefix}audiobook.json`) {
      throw new NonRetryableError("Prepared narration is unavailable");
    }
    return loadAudiobook({ bucket, audiobookReference: manifest });
  });
  const unit = audiobook.narrationDocument.synchronizationUnits[sequence];
  if (!unit) {
    throw new NonRetryableError("Synchronization unit does not exist");
  }

  const synthesize = (rateLimitWaits: number) =>
    step.do(
      rateLimitWaits === 0
        ? "synthesize and settle audio segment"
        : `synthesize and settle audio segment after rate limit wait ${rateLimitWaits}`,
      {
        retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
        timeout: "2 minutes",
      },
      async ({ attempt }) => {
        // The owner reserves the whole document or nothing; a lone segment never reserves itself.
        const state = await execution.getAudioSegmentState(sequence);
        if (state !== "reserved" && state !== "settled") {
          throw new NonRetryableError(
            "This segment has no duration reservation. Retry to generate the missing audio.",
          );
        }
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
          await execution.completeAudioSegment(sequence, segment.durationMilliseconds);
          return segment;
        } catch (error) {
          if (
            error instanceof RateLimitedNarrationSynthesisError &&
            rateLimitWaits < MAX_RATE_LIMIT_WAITS
          ) {
            return "rate-limited" as const;
          }
          if (error instanceof PermanentNarrationSynthesisError) {
            throw new NonRetryableError(error.message);
          }
          throw error;
        }
      },
    );

  try {
    for (let rateLimitWaits = 0; ; rateLimitWaits += 1) {
      const outcome = await synthesize(rateLimitWaits);
      if (outcome !== "rate-limited") {
        return outcome;
      }

      await step.sleep(
        `wait for speech provider rate limit ${rateLimitWaits + 1}`,
        RATE_LIMIT_WAIT,
      );
    }
  } catch (error) {
    await step.do("release failed segment reservation", async () => {
      await execution.releaseAudioSegment(sequence);
      await bucket.put(
        `${prefix}segment-${sequence}-failure.json`,
        JSON.stringify({
          explanation:
            error instanceof Error
              ? error.message
              : "Speech generation failed. Retry this segment.",
        }),
        { httpMetadata: { contentType: "application/json" } },
      );
    });
    throw error;
  }
}
