import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { notifyError, toastManager } from "#src/notifications.js";

/**
 * Failures are reported with a toast. A query or mutation whose component shows the failure in
 * place opts out with an `errorDisplay` of "inline".
 */
type ErrorDisplayMeta = {
  errorDisplay?: "inline";
  /** Names what failed in the toast, for example "The retry could not start." */
  errorTitle?: string;
};

declare module "@tanstack/react-query" {
  // oxlint-disable typescript/consistent-type-definitions -- TanStack Query requires interface merging to register meta types.
  interface Register {
    queryMeta: ErrorDisplayMeta;
    mutationMeta: ErrorDisplayMeta;
  }
  // oxlint-enable typescript/consistent-type-definitions
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Without data, the page has nothing to show and reports the failure in place of its content.
      if (query.state.data === undefined || query.meta?.errorDisplay === "inline") {
        return;
      }

      // A polling query keeps failing while the connection is down; one toast covers all attempts.
      notifyError(error, { title: query.meta?.errorTitle, id: toastIdOfQuery(query.queryHash) });
    },
    onSuccess: (_data, query) => toastManager.close(toastIdOfQuery(query.queryHash)),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.errorDisplay === "inline") {
        return;
      }

      notifyError(error, { title: mutation.meta?.errorTitle });
    },
  }),
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      gcTime: 0,
      staleTime: 0,
    },
  },
});

function toastIdOfQuery(queryHash: string) {
  return `query:${queryHash}`;
}
