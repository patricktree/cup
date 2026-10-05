import type { ConversionOwner } from "@cup/conversion-contracts";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { resolveConversionReader } from "#src/conversion-reader.ts";
import { getAudioSegmentState } from "#src/use-cases/get-audio-segment-state.ts";

export function getAudioSegmentStateFromEnvironment(
  env: ApiServerEnvironment,
  conversionId: string,
  owner: ConversionOwner,
  sequence: number,
  origin: string,
) {
  const reader = resolveConversionReader(env, conversionId, owner);

  return getAudioSegmentState(
    { conversionId, owner, sequence, origin },
    {
      listAudioSegments: () => reader.listAudioSegments(),
      getWorkflowStatus: async (id) =>
        (await env.SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW.get(id)).status(),
      getFailureExplanation: async (key) => {
        const failure = await env.AUDIO_BUCKET.get(key);
        return failure ? (await failure.json<{ explanation: string }>()).explanation : undefined;
      },
    },
  );
}
