import type { SupabaseClient } from "@supabase/supabase-js";

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
  fresh: boolean,
) {
  const result = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
      queryParams: googleAuthorizationParams(fresh),
    },
  });
  if (result.error) {
    throw result.error;
  }
}

/**
 * Google's authorization parameters: always the account chooser, and for a fresh sign-in, such as
 * before account deletion, a new authentication however recent the last one was.
 */
export function googleAuthorizationParams(fresh: boolean): Record<string, string> {
  return fresh ? { prompt: "select_account", max_age: "0" } : { prompt: "select_account" };
}

/** The browser keeps no sign-in of its own beyond the account session. */
export async function clearNativeSignIn(): Promise<void> {}
