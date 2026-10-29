import { infiniteQueryOptions, useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import React from "react";

import { accountHistorySchema, type AccountHistory } from "@cup/listener-api.routes";

import { requestApi } from "#src/data-fetching/api-request.js";
import { queryClient } from "#src/data-fetching/query-client.js";
import { QUERY_KEYS } from "#src/data-fetching/query-keys.js";

export function createAccountHistoryQuery(subject: string) {
  return infiniteQueryOptions({
    queryKey: QUERY_KEYS.accountHistory(subject),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      accountHistorySchema.parse(
        await requestApi({ subject }, (client) => client.getHistory(pageParam ?? undefined)),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    meta: { errorTitle: "Your tracks could not be updated." },
    refetchInterval: (query) =>
      query.state.status !== "error" &&
      query.state.data?.pages.some((page) => page.items.some((item) => item.status === "pending"))
        ? 5_000
        : false,
  });
}

/**
 * Whether the signed-in account's history lists the conversion, which tells the account's own
 * conversion from a trial one the listener can also open. It loads further history pages until it
 * finds the conversion or runs out of pages, and is `false` until then. It never polls itself.
 */
export function useIsAccountConversion(subject: string | undefined, conversionId: string): boolean {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    // Without an account there is no history to look in, and the query never runs.
    ...createAccountHistoryQuery(subject ?? ""),
    enabled: subject !== undefined,
    refetchInterval: false,
  });
  const isListed =
    data?.pages.some((page) => page.items.some((item) => item.conversionId === conversionId)) ??
    false;

  React.useEffect(
    function loadHistoryUntilListed() {
      if (!isListed && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    },
    [isListed, hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  return isListed;
}

/**
 * Removes a deleted conversion from the cached history pages, so Recents never lists it while its
 * history is requested again. Cancels history requests in flight first, because one sent before the
 * deletion would put the conversion back. The caller invalidates the history afterwards.
 */
export async function removeFromCachedAccountHistory(subject: string, conversionId: string) {
  const queryKey = QUERY_KEYS.accountHistory(subject);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<InfiniteData<AccountHistory, string | null>>(queryKey, (history) =>
    history
      ? {
          ...history,
          pages: history.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.conversionId !== conversionId),
          })),
        }
      : undefined,
  );
}
