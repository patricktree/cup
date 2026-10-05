import React from "react";

import { authStateSnapshot, subscribeAuthState } from "#src/auth/account-session.js";

export function useAccountAuthState() {
  return React.useSyncExternalStore(subscribeAuthState, authStateSnapshot, authStateSnapshot);
}

export function useAccountSession() {
  const state = useAccountAuthState();
  return state.status === "signed-in" ? state.session : null;
}
