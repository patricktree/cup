import { queryOptions, useMutation, type QueryClient } from "@tanstack/react-query";

import {
  audiobookSchema,
  playbackPositionSchema,
  retryConversionResponseSchema,
  type Audiobook,
  type PlaybackPosition,
} from "@cup/web-app-api.routes";

import { requestApi } from "#src/data-fetching/api-request.js";

const POLL_INTERVAL_MS = 1_000;

export function createAudiobookQuery(conversionId: string) {
  return queryOptions({
    queryKey: ["audiobook", conversionId],
    queryFn: ({ signal }) => getAudiobook(conversionId, signal),
    meta: { errorTitle: "The article could not be updated." },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "synthesizing" ? POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: true,
  });
}
async function getAudiobook(conversionId: string, signal: AbortSignal): Promise<Audiobook> {
  return audiobookSchema.parse(
    await requestApi("optional", (client) => client.getAudiobook({ conversionId }, signal)),
  );
}
/** Retries preparation, or synthesis of the segments still lacking audio once prepared. */
export function useRetryConversion(conversionId: string, queryClient: QueryClient) {
  return useMutation({
    meta: { errorTitle: "The retry could not start." },
    mutationFn: () => retryConversion(conversionId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: createAudiobookQuery(conversionId).queryKey }),
  });
}
async function retryConversion(conversionId: string) {
  return retryConversionResponseSchema.parse(
    await requestApi("optional", (client) => client.retryConversion({ conversionId })),
  );
}
export function getLocalPlaybackPosition(conversionId: string): PlaybackPosition | null {
  const value = localStorage.getItem(`cup:position:v1:${conversionId}`);
  if (!value) {
    return null;
  }
  try {
    const result = playbackPositionSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    // A corrupt device-local listening position must not make the article unreadable.
    return null;
  }
}
export async function savePlaybackPosition(
  conversionId: string,
  position: PlaybackPosition,
  subject: string | null,
) {
  if (!subject) {
    localStorage.setItem(`cup:position:v1:${conversionId}`, JSON.stringify(position));
    return;
  }
  await requestApi({ subject }, (client) => client.savePosition({ conversionId }, position));
}
