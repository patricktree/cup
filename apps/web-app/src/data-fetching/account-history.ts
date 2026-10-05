import { infiniteQueryOptions } from "@tanstack/react-query";

import { parseOkResponse } from "@cup/web-app-api.client";
import { accountHistorySchema } from "@cup/web-app-api.routes";

import { getAuthenticatedRpcClient } from "#src/auth/account-session.js";
import { queryClient } from "#src/data-fetching/query-client.js";

export function createAccountHistoryQuery(subject?: string) {
  return infiniteQueryOptions({
    queryKey: ["account-history", subject],
    enabled: !!subject,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      accountHistorySchema.parse(
        await parseOkResponse(
          (await getAuthenticatedRpcClient(subject)).getHistory(pageParam ?? undefined),
        ),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
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
