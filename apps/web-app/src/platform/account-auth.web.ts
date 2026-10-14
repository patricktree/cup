import type { Session, SupabaseClient } from "@supabase/supabase-js";

/** Prepares storage for the account session, which is kept under `storageKeys`. */
export async function initializeAuthStorage(storageKeys: readonly string[]) {
  const storage = window.localStorage;
  return {
    storage,
    detectSessionInUrl: true,
    clearStoredSession: async () => {
      for (const key of storageKeys) storage.removeItem(key);
    },
  };
}
export async function addAuthResumeListener(_onResume: () => void): Promise<void> {}
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
  if (result.error) throw result.error;
}

export async function setNativeMediaSession(_session: Session): Promise<void> {}
export async function clearNativeAuthSession(): Promise<void> {}
