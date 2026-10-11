import { z } from "zod";

export const segmentUsageSchema = z
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
  if (usage.length === 0) return "insufficient-duration";
  return usage.some((segment) => segment.state === "reserved") ? "synthesizing" : "ready";
}

export function estimateAudioDuration(narrationTextCharacters: number): number {
  if (!Number.isSafeInteger(narrationTextCharacters) || narrationTextCharacters < 1)
    throw new Error("Narration character count must be a positive safe integer");
  // Reserve 1 minute 20 seconds per 1,000 characters, with a one-second minimum.
  const estimate = Math.max(1_000, narrationTextCharacters * 80);
  if (!Number.isSafeInteger(estimate))
    throw new Error("Estimated duration exceeds supported precision");
  return estimate;
}

export function calculateDurationBalance(
  allowanceMilliseconds: number,
  usage: readonly SegmentUsage[],
) {
  const spentMilliseconds = usage.reduce(
    (total, segment) => total + segment.chargedMilliseconds,
    0,
  );
  const reservedMilliseconds = usage.reduce(
    (total, segment) => total + (segment.state === "reserved" ? segment.estimatedMilliseconds : 0),
    0,
  );
  return {
    availableMilliseconds: Math.max(
      0,
      allowanceMilliseconds - spentMilliseconds - reservedMilliseconds,
    ),
    reservedMilliseconds,
    spentMilliseconds,
  };
}
