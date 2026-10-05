import { useMutation, type QueryClient } from "@tanstack/react-query";

import {
  audioSegmentSchema,
  playbackPositionSchema,
  type PlaybackPosition,
} from "@cup/web-app-api.routes";

import { createAppApiClient } from "#src/api-client.js";
import { getResourceAccountSession } from "#src/auth/account-session.js";
import { createAudiobookQuery } from "#src/data-fetching/trial-link.js";
import { parseResponse } from "#src/data-fetching/trial-link.js";

const client = createAppApiClient();
async function readerClient() {
  const session = await getResourceAccountSession();
  return session ? client.createAuthenticatedRpcClient(session.access_token) : client;
}
export async function requestAudioSegment(conversionId: string, unitIndex: number, retry: boolean) {
  return parseResponse(
    await (await readerClient()).generateSegment({ conversionId }, unitIndex, retry),
    (body) => audioSegmentSchema.parse(body),
  );
}
export async function getAudioSegment(conversionId: string, unitIndex: number) {
  return parseResponse(
    await (await readerClient()).getSegment({ conversionId }, unitIndex),
    (body) => audioSegmentSchema.parse(body),
  );
}
export function useRetryPreparation(conversionId: string, queryClient: QueryClient) {
  return useMutation({
    mutationFn: () => retryPreparation(conversionId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: createAudiobookQuery(conversionId).queryKey }),
  });
}
async function retryPreparation(conversionId: string) {
  const response = await (await readerClient()).retryPreparation({ conversionId });
  if (!response.ok) await parseResponse(response, () => undefined);
}
export function getLocalPlaybackPosition(conversionId: string): PlaybackPosition | null {
  const value = localStorage.getItem(`cup:position:v1:${conversionId}`);
  if (!value) return null;
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
  const session = await getResourceAccountSession();
  if (session?.user.id !== subject)
    throw new Error("Listening position belongs to a different signed-in user.");
  const response = await client
    .createAuthenticatedRpcClient(session.access_token)
    .savePosition({ conversionId }, position);
  if (!response.ok) await parseResponse(response, () => undefined);
}
