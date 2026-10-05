import type { Session, SupabaseClient } from "@supabase/supabase-js";

import {
  ACCOUNT_SESSION_STORAGE_KEY,
  ACCOUNT_SESSION_CODE_VERIFIER_STORAGE_KEY,
} from "#src/auth/account-session-storage.js";

export async function initializeAuthStorage() {
  const storage = window.localStorage;
  return {
    storage,
    detectSessionInUrl: true,
    clearStoredSession: async () => {
      storage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
      storage.removeItem(ACCOUNT_SESSION_CODE_VERIFIER_STORAGE_KEY);
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
