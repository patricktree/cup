import {
  estimateAudioDuration,
  type InsufficientDuration,
  type SegmentUsage,
} from "@cup/conversion-contracts/duration-accounting";
import type { AudioSegment } from "@cup/listener-api.routes";

export type SynthesisState =
  | { status: "synthesizing" | "ready"; segments: AudioSegment[] }
  | ({ status: "insufficient-duration"; segments: AudioSegment[] } & InsufficientDuration);

export type GetSynthesisStateDependencies = {
  listAudioSegments(): Promise<
    readonly Pick<SegmentUsage, "sequence" | "state" | "actualMilliseconds">[]
  >;
  getAvailableMilliseconds(): Promise<number>;
  getFailureExplanation(sequence: number): Promise<string | undefined>;
};

/**
 * Derives a prepared conversion's status from its owner's reservations and settlements.
 *
 * Reservations are taken for the whole narration document or not at all, so a segment without any
 * reservation means the document did not fit the available duration.
 */
export async function getSynthesisState(
  {
    conversionId,
    origin,
    narrationTextCharactersBySegment,
  }: {
    conversionId: string;
    origin: string;
    narrationTextCharactersBySegment: readonly number[];
  },
  dependencies: GetSynthesisStateDependencies,
): Promise<SynthesisState> {
  const usage = new Map(
    (await dependencies.listAudioSegments()).map((segment) => [segment.sequence, segment]),
  );

  const segments = await Promise.all(
    narrationTextCharactersBySegment.map(async (_characters, sequence): Promise<AudioSegment> => {
      const segment = usage.get(sequence);
      if (segment === undefined) {
        return { sequence, status: "absent" };
      }
      if (segment.state === "reserved") {
        return { sequence, status: "generating" };
      }
      if (segment.state === "settled") {
        return {
          sequence,
          status: "ready",
          durationMilliseconds: segment.actualMilliseconds,
          url: `${origin}/api/files/audiobooks/${conversionId}/segments/${sequence}/audio.mp3`,
        };
      }

      return {
        sequence,
        status: "failed",
        explanation:
          (await dependencies.getFailureExplanation(sequence)) ??
          "Speech generation failed. Retry to generate this segment.",
      };
    }),
  );

  const requiredMilliseconds = narrationTextCharactersBySegment.reduce(
    (total, characters, sequence) =>
      usage.has(sequence) ? total : total + estimateAudioDuration(characters),
    0,
  );
  if (requiredMilliseconds > 0) {
    return {
      status: "insufficient-duration",
      segments,
      requiredMilliseconds,
      availableMilliseconds: await dependencies.getAvailableMilliseconds(),
    };
  }

  return {
    status: segments.some((segment) => segment.status === "generating") ? "synthesizing" : "ready",
    segments,
  };
}
