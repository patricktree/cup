import { App } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Temporal } from "temporal-polyfill";

import {
  ACCOUNT_SESSION_STORAGE_KEY,
  ACCOUNT_SESSION_CODE_VERIFIER_STORAGE_KEY,
} from "#src/data-fetching/account-session-storage.js";

const nativeMedia = registerPlugin<{
  setSession(input: { token: string; maxAge: number }): Promise<void>;
  clearSession(): Promise<void>;
}>("AccountMedia");

export async function initializeAuthStorage() {
  const storage = (await import("@aparajita/capacitor-secure-storage")).SecureStorage;
  return {
    storage,
    detectSessionInUrl: false,
    clearStoredSession: async () => {
      await storage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
      await storage.removeItem(ACCOUNT_SESSION_CODE_VERIFIER_STORAGE_KEY);
    },
  };
}
export async function addAuthResumeListener(onResume: () => void): Promise<void> {
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) onResume();
  });
}
export async function signInWithGoogle(
  client: SupabaseClient,
  googleClientId: string | undefined,
  fresh: boolean,
) {
  const { GoogleSignIn } = await import("@capawesome/capacitor-google-sign-in");
  if (!googleClientId) throw new Error("Sign-in is temporarily unavailable.");
  await GoogleSignIn.initialize({ clientId: googleClientId });
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(nonceBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const hashedNonce = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce))),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  if (fresh) await GoogleSignIn.signOut();
  const result = await GoogleSignIn.signIn({ nonce: hashedNonce });
  const exchange = await client.auth.signInWithIdToken({
    provider: "google",
    token: result.idToken,
    nonce,
  });
  if (exchange.error) throw exchange.error;
}
export async function setNativeMediaSession(latest: Session): Promise<void> {
  await nativeMedia.setSession({
    token: latest.access_token,
    maxAge: Math.max(
      0,
      (latest.expires_at ?? 0) - Math.floor(Temporal.Now.instant().epochMilliseconds / 1000),
    ),
  });
}
export async function clearNativeAuthSession(): Promise<void> {
  await nativeMedia.clearSession();
  const { GoogleSignIn } = await import("@capawesome/capacitor-google-sign-in");
  await GoogleSignIn.signOut();
}
