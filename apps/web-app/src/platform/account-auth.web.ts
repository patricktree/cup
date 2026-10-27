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
      queryParams: fresh
        ? { prompt: "select_account", max_age: "0" }
        : { prompt: "select_account" },
    },
  });
  if (result.error) {
    throw result.error;
  }
}

/** The browser keeps no sign-in of its own beyond the account session. */
export async function clearNativeSignIn(): Promise<void> {}
