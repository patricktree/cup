import { queryOptions } from "@tanstack/react-query";
import React from "react";

import { parseOkResponse } from "@cup/web-app-api.client";

import {
  getAuthenticatedRpcClient,
  authStateSnapshot,
  subscribeAuthState,
} from "#src/data-fetching/account-session.js";
import { queryClient } from "#src/data-fetching/query-client.js";

export function useAccountAuthState() {
  return React.useSyncExternalStore(subscribeAuthState, authStateSnapshot, authStateSnapshot);
}

export function useAccountSession() {
  const state = useAccountAuthState();
  return state.status === "signed-in" ? state.session : null;
}

export const accountQuery = (subject?: string) =>
  queryOptions({
    queryKey: ["account", subject],
    enabled: !!subject,
    queryFn: async () => parseOkResponse((await getAuthenticatedRpcClient(subject)).getAccount()),
    retry: false,
  });

export function invalidateAccountQueries(subject?: string) {
  return queryClient.invalidateQueries({
    queryKey: subject === undefined ? ["account"] : accountQuery(subject).queryKey,
  });
}
