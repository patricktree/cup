import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `fresh` authenticates again however recent the last authentication was, such as before account
 * deletion. `chooseAccount` shows Google's account chooser, which the session lifecycle asks for on
 * the first sign-in after a sign-out on this device.
 */
export type GoogleSignInOptions = { fresh: boolean; chooseAccount: boolean };

/** Prepares storage for the account session, which is kept under `storageKeys`. */
export async function initializeAuthStorage(storageKeys: readonly string[]) {
  const storage = window.localStorage;
  return {
    storage,
    detectSessionInUrl: true,
    clearStoredSession: async () => {
      for (const key of storageKeys) {
        storage.removeItem(key);
      }
    },
  };
}
export async function signInWithGoogle(
  client: SupabaseClient,
  _googleClientId: string | undefined,
  options: GoogleSignInOptions,
) {
  const result = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
      queryParams: googleAuthorizationParams(options),
    },
  });
  if (result.error) {
    throw result.error;
  }
}

/**
 * Google's authorization parameters. Without `prompt`, Google skips its account chooser when it
 * can, so a normal sign-in takes one tap less; a fresh sign-in keeps the chooser and adds
 * `max_age=0`.
 */
export function googleAuthorizationParams({
  fresh,
  chooseAccount,
}: GoogleSignInOptions): Record<string, string> {
  if (fresh) {
    return { prompt: "select_account", max_age: "0" };
  }
  if (chooseAccount) {
    return { prompt: "select_account" };
  }
  return {};
}

/**
 * Reports nothing: supabase-js refreshes the session only while the page is visible, as long as
 * nothing calls its `startAutoRefresh` or `stopAutoRefresh`, which remove that handling.
 */
export function watchAppState(_listener: (isActive: boolean) => void): () => void {
  return () => {};
}

/** The browser keeps no sign-in of its own beyond the account session. */
export async function clearNativeSignIn(): Promise<void> {}
