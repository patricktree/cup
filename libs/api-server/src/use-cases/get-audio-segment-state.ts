import { createConversionArtifactPrefix, type ConversionOwner } from "@cup/conversion-contracts";
import type { SegmentUsage } from "@cup/conversion-contracts/duration-accounting";
import type { AudioSegment } from "@cup/web-app-api.routes";

export type GetAudioSegmentStateDependencies = {
  listAudioSegments(
    conversionId: string,
  ): Promise<readonly Pick<SegmentUsage, "sequence" | "state" | "actualMilliseconds">[]>;
  getWorkflowStatus(id: string): Promise<{ status: string; error?: { message: string } }>;
  getFailureExplanation(key: string): Promise<string | undefined>;
};

/** Derives playable segment state from settlement and durable synthesis progress. */
export async function getAudioSegmentState(
  {
    conversionId,
    owner,
    sequence,
    origin,
  }: {
    conversionId: string;
    owner: ConversionOwner;
    sequence: number;
    origin: string;
  },
  dependencies: GetAudioSegmentStateDependencies,
): Promise<AudioSegment> {
  const usage = await dependencies.listAudioSegments(conversionId);
  const segment = usage.find((item) => item.sequence === sequence);
  if (segment?.state === "settled")
    return {
      sequence,
      status: "ready",
      durationMilliseconds: segment.actualMilliseconds,
      url: `${origin}/api/files/audiobooks/${conversionId}/segments/${sequence}/audio.mp3`,
    };
  let status;
  try {
    status = await dependencies.getWorkflowStatus(`segment-${conversionId}-${sequence}`);
  } catch {
    return { sequence, status: "absent" };
  }
  if (status.status === "errored" || status.status === "terminated") {
    const explanation = await dependencies.getFailureExplanation(
      `${createConversionArtifactPrefix(conversionId, owner)}segment-${sequence}-failure.json`,
    );
    return {
      sequence,
      status: "failed",
      explanation:
        explanation ?? status.error?.message ?? "Speech generation failed. Retry this passage.",
    };
  }
  if (status.status === "complete")
    throw new Error(
      `Completed segment is missing its settlement: ${createConversionArtifactPrefix(conversionId, owner)}${sequence}`,
    );
  return { sequence, status: "generating" };
}
