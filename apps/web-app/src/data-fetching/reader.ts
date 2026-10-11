import { useMutation, type QueryClient } from "@tanstack/react-query";

import {
  playbackPositionSchema,
  retryConversionResponseSchema,
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
/** Retries preparation, or synthesis of the segments still lacking audio once prepared. */
export function useRetryConversion(conversionId: string, queryClient: QueryClient) {
  return useMutation({
    mutationFn: () => retryConversion(conversionId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: createAudiobookQuery(conversionId).queryKey }),
  });
}
async function retryConversion(conversionId: string) {
  return parseResponse(await (await readerClient()).retryConversion({ conversionId }), (body) =>
    retryConversionResponseSchema.parse(body),
  );
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
