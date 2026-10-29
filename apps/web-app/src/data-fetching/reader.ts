import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  audiobookSchema,
  playbackPositionSchema,
  retryConversionResponseSchema,
  type Audiobook,
  type PlaybackPosition,
} from "@cup/listener-api.routes";

import { invalidateAccountHistory } from "#src/data-fetching/account-history.js";
import { ERROR_CODE, requestApi, RpcError } from "#src/data-fetching/api-request.js";
import { notifyError } from "#src/notifications.js";

const POLL_INTERVAL_MS = 1_000;
const AUDIOBOOK_UPDATE_ERROR_TITLE = "The track could not be updated.";

export function createAudiobookQuery(conversionId: string) {
  return queryOptions({
    queryKey: ["audiobook", conversionId],
    queryFn: ({ signal }) => getAudiobook(conversionId, signal),
    meta: { errorTitle: AUDIOBOOK_UPDATE_ERROR_TITLE },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "synthesizing" ? POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: true,
  });
}
async function getAudiobook(conversionId: string, signal?: AbortSignal): Promise<Audiobook> {
  return audiobookSchema.parse(
    await requestApi("optional", (client) => client.getAudiobook({ conversionId }, signal)),
  );
}

/**
 * Requests the audiobook again for the player, for a newly signed narration track URL, and shares
 * the response with its page. Resolves to `null` when the conversion no longer exists, which the
 * player reports in place, so only other failures are reported with a toast. It bypasses the
 * audiobook query: a failed query that has data always reports with a toast.
 */
export async function fetchAudiobookForPlayer(
  queryClient: QueryClient,
  conversionId: string,
): Promise<Audiobook | null> {
  let audiobook: Audiobook;
  try {
    audiobook = await getAudiobook(conversionId);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    notifyError(error, { title: AUDIOBOOK_UPDATE_ERROR_TITLE });
    throw error;
  }

  queryClient.setQueryData(createAudiobookQuery(conversionId).queryKey, audiobook);
  return audiobook;
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

/**
 * Deletes an account conversion. A conversion already gone counts as deleted, and the dialog that
 * starts the deletion shows a failure in place of a toast. Its page is left before its audiobook
 * query is dropped, so the page cannot request the deleted audiobook again.
 */
export function useDeleteConversion({
  subject,
  conversionId,
  onDeleted,
}: {
  /** The signed-in account's; absent for trial listeners, who cannot delete a conversion. */
  subject: string | undefined;
  conversionId: string;
  onDeleted: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorDisplay: "inline" },
    mutationFn: () => {
      check.assert(subject, "Only a signed-in account deletes a conversion.");
      return deleteConversion(subject, conversionId);
    },
    onSuccess: async () => {
      await onDeleted();
      queryClient.removeQueries({ queryKey: createAudiobookQuery(conversionId).queryKey });
      await invalidateAccountHistory(subject);
    },
  });
}
async function deleteConversion(subject: string, conversionId: string): Promise<void> {
  try {
    await requestApi({ subject }, (client) => client.deleteConversion({ conversionId }));
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

function isNotFound(error: unknown) {
  return error instanceof RpcError && error.code === ERROR_CODE.AUDIOBOOK_NOT_FOUND;
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
