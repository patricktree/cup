import type { SupabaseClient } from "@supabase/supabase-js";

/** Prepares storage for the account session, which is kept under `storageKeys`. */
export async function initializeAuthStorage(storageKeys: readonly string[]) {
  const storage = (await import("@aparajita/capacitor-secure-storage")).SecureStorage;
  return {
    storage,
    detectSessionInUrl: false,
    clearStoredSession: async () => {
      for (const key of storageKeys) {
        await storage.removeItem(key);
      }
    },
  };
}
export async function signInWithGoogle(
  client: SupabaseClient,
  googleClientId: string | undefined,
  fresh: boolean,
) {
  const { GoogleSignIn } = await import("@capawesome/capacitor-google-sign-in");
  if (!googleClientId) {
    throw new Error("Sign-in is temporarily unavailable.");
  }
  await GoogleSignIn.initialize({ clientId: googleClientId });
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(nonceBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const hashedNonce = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce))),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  if (fresh) {
    await GoogleSignIn.signOut();
  }
  const result = await GoogleSignIn.signIn({ nonce: hashedNonce });
  const exchange = await client.auth.signInWithIdToken({
    provider: "google",
    token: result.idToken,
    nonce,
  });
  if (exchange.error) {
    throw exchange.error;
  }
}
/** Signs out of Google on the device, so the next sign-in can pick another account. */
export async function clearNativeSignIn(): Promise<void> {
  const { GoogleSignIn } = await import("@capawesome/capacitor-google-sign-in");
  await GoogleSignIn.signOut();
}
