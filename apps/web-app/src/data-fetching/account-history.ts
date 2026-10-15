import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { infiniteQueryOptions } from "@tanstack/react-query";

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
    meta: { errorTitle: "Your conversions could not be updated." },
    refetchInterval: (query) =>
      query.state.status !== "error" &&
      query.state.data?.pages.some((page) => page.items.some((item) => item.status === "pending"))
        ? 5_000
        : false,
  });
}

export function invalidateAccountHistory(subject?: string) {
  return queryClient.invalidateQueries({ queryKey: createAccountHistoryQuery(subject).queryKey });
}
