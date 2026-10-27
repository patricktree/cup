import { z } from "zod";

const segmentUsageSchema = z
  .object({
    conversionId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    narrationTextCharacters: z.number().int().positive(),
    estimatedMilliseconds: z.number().int().positive(),
    state: z.enum(["reserved", "settled", "released"]),
    actualMilliseconds: z.number().int().nonnegative(),
    chargedMilliseconds: z.number().int().nonnegative(),
  })
  .strict();
export type SegmentUsage = z.infer<typeof segmentUsageSchema>;

/** How much audio a narration document needs and how much its owner can still reserve. */
export const insufficientDurationSchema = z
  .object({
    requiredMilliseconds: z.number().int().positive(),
    availableMilliseconds: z.number().int().nonnegative(),
  })
  .strict();
export type InsufficientDuration = z.infer<typeof insufficientDurationSchema>;

export type PreparedConversionStatus = "insufficient-duration" | "synthesizing" | "ready";

/**
 * Derives a prepared conversion's status from its segments' reservations and settlements.
 *
 * Reservations are taken for the whole narration document or not at all, so a prepared conversion
 * without any did not fit the available duration.
 */
export function derivePreparedConversionStatus(
  usage: readonly Pick<SegmentUsage, "state">[],
): PreparedConversionStatus {
  if (usage.length === 0) {
    return "insufficient-duration";
  }
  return usage.some((segment) => segment.state === "reserved") ? "synthesizing" : "ready";
}

/**
 * Returns the settled durations of a conversion's segments in sequence order when its narration
 * track exists, which is when the ledger has segments and every one of them is settled. A ready
 * conversion with a failed segment has no narration track.
 */
export function findNarrationTrackDurations(
  usage: readonly Pick<SegmentUsage, "sequence" | "state" | "actualMilliseconds">[],
): number[] | undefined {
  if (usage.length === 0 || usage.some((segment) => segment.state !== "settled")) {
    return undefined;
  }

  const segments = [...usage].sort((left, right) => left.sequence - right.sequence);
  // Reservations cover the whole narration document, so settled rows are never partial.
  if (segments.some((segment, index) => segment.sequence !== index)) {
    throw new Error("Narration track segments must have consecutive sequences from 0");
  }

  return segments.map((segment) => segment.actualMilliseconds);
}

export function estimateAudioDuration(narrationTextCharacters: number): number {
  if (!Number.isSafeInteger(narrationTextCharacters) || narrationTextCharacters < 1) {
    throw new Error("Narration character count must be a positive safe integer");
  }
  // Reserve 1 minute 20 seconds per 1,000 characters, with a one-second minimum.
  const estimate = Math.max(1_000, narrationTextCharacters * 80);
  if (!Number.isSafeInteger(estimate)) {
    throw new Error("Estimated duration exceeds supported precision");
  }
  return estimate;
}
