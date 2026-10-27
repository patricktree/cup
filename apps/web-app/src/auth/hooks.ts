import React from "react";

import {
  authStateSnapshot,
  signInMethodsSnapshot,
  subscribeAuthState,
} from "#src/auth/account-session.js";

export function useAccountAuthState() {
  return React.useSyncExternalStore(subscribeAuthState, authStateSnapshot, authStateSnapshot);
}

/** Account auth initializing changes the shown state, which republishes the offered methods. */
export function useSignInMethods() {
  return React.useSyncExternalStore(
    subscribeAuthState,
    signInMethodsSnapshot,
    signInMethodsSnapshot,
  );
}

export function useAccountSession() {
  const state = useAccountAuthState();
  return state.status === "signed-in" ? state.session : null;
}
