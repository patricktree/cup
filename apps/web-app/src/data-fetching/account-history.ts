import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import React from "react";

import { accountHistorySchema } from "@cup/listener-api.routes";

import { requestApi } from "#src/data-fetching/api-request.js";
import { queryClient } from "#src/data-fetching/query-client.js";

export function createAccountHistoryQuery(subject?: string) {
  return infiniteQueryOptions({
    queryKey: ["account-history", subject],
    enabled: !!subject,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      check.assert(subject, "The history query runs only for a signed-in account.");
      return accountHistorySchema.parse(
        await requestApi({ subject }, (client) => client.getHistory(pageParam ?? undefined)),
      );
    },
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
    ...createAccountHistoryQuery(subject),
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

export function invalidateAccountHistory(subject?: string) {
  return queryClient.invalidateQueries({ queryKey: createAccountHistoryQuery(subject).queryKey });
}

/**
 * Takes a deleted conversion out of the cached history, so Recents cannot list it while its refresh
 * runs. A request already under way started before the deletion and may still list it, so it is
 * cancelled first.
 */
export async function removeFromAccountHistory(subject: string | undefined, conversionId: string) {
  const { queryKey } = createAccountHistoryQuery(subject);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, (history) =>
    history
      ? {
          ...history,
          pages: history.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.conversionId !== conversionId),
          })),
        }
      : history,
  );
}
