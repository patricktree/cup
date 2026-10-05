import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import { parseOkResponse } from "@cup/web-app-api.client";
import { authConfigResponseSchema } from "@cup/web-app-api.routes";

import { createAppApiClient } from "#src/api-client.js";
import { ACCOUNT_SESSION_STORAGE_KEY } from "#src/data-fetching/account-session-storage.js";
import { queryClient } from "#src/data-fetching/query-client.js";
import {
  initializeAuthStorage,
  addAuthResumeListener,
  signInWithGoogle,
  setNativeMediaSession,
  clearNativeAuthSession,
} from "#src/platform/account-auth.js";
import { stopNativePlayback } from "#src/platform/native-player.js";
import { STOP_PLAYBACK_EVENT_NAME } from "#src/playback-events.js";
import { trialBrowserState } from "#src/trial-browser-state.js";

type AccountAuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session }
  | { status: "error"; error: Error };

const listeners = new Set<() => void>();
let authState: AccountAuthState = { status: "loading" };
let clientPromise: Promise<SupabaseClient> | undefined;
let googleClientId: string | undefined;
let clearStoredSession: (() => Promise<void>) | undefined;
let sessionGeneration = 0;
let previousSubject: string | null | undefined;
let isSigningOut = false;
let mediaUpdates: Promise<void> = Promise.resolve();

export const authStateSnapshot = () => authState;
export const sessionSnapshot = () => (authState.status === "signed-in" ? authState.session : null);
export const subscribeAuthState = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function publish(next: AccountAuthState) {
  authState = next;
  for (const listener of listeners) listener();
}

function publishSession(session: Session | null) {
  const subject = session?.user.id ?? null;
  if (previousSubject !== subject) {
    if (previousSubject) {
      sessionGeneration += 1;
      // Initial restoration can be awaited by active route loaders; keep those queries alive.
      queryClient.clear();
    }
    stopPlayback();
    if (subject) trialBrowserState.clearLastGrantId();
    previousSubject = subject;
  }
  publish(session ? { status: "signed-in", session } : { status: "signed-out" });
}

export async function ensureAuthInitialized(): Promise<SupabaseClient> {
  if (!clientPromise && !isSigningOut) {
    publish({ status: "loading" });
  }

  clientPromise ??= initializeAuth().catch((error: unknown) => {
    if (!isSigningOut) {
      publish({
        status: "error",
        error: error instanceof Error ? error : new Error("Sign-in is temporarily unavailable."),
      });
    }
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}

async function initializeAuth() {
  const config = authConfigResponseSchema.parse(
    await parseOkResponse(createAppApiClient().getAuthConfig()),
  );
  googleClientId = config.googleWebClientId;
  const platformStorage = await initializeAuthStorage();
  clearStoredSession = platformStorage.clearStoredSession;
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      storageKey: ACCOUNT_SESSION_STORAGE_KEY,
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: platformStorage.detectSessionInUrl,
      storage: platformStorage.storage,
    },
  });
  client.auth.onAuthStateChange((_event, next) => {
    if (!isSigningOut) publishSession(next);
  });
  const restored = await client.auth.getSession();
  if (restored.error) throw restored.error;
  if (!isSigningOut) publishSession(restored.data.session);
  await addAuthResumeListener(() => {
    void getFreshAccountSession().then(refreshPlaybackAuthorization).catch(stopPlayback);
  });
  return client;
}

export async function getFreshAccountSession() {
  const generation = sessionGeneration;
  if (isSigningOut) return null;
  const client = await ensureAuthInitialized();
  const result = await client.auth.getSession();
  if (result.error) throw result.error;
  if (isSigningOut || generation !== sessionGeneration) return null;
  return result.data.session;
}

/** Public trial resources remain available if account initialization fails. */
export async function getResourceAccountSession() {
  try {
    return await getFreshAccountSession();
  } catch (error) {
    if (sessionSnapshot()) throw error;
    return null;
  }
}

export async function signInGoogle(fresh = false) {
  if (isSigningOut) throw new Error("Wait for sign-out to finish before signing in.");
  sessionGeneration += 1;
  stopPlayback();
  const client = await ensureAuthInitialized();
  await client.auth.startAutoRefresh();
  await signInWithGoogle(client, googleClientId, fresh);
}

function stopPlayback() {
  stopNativePlayback();
  window.dispatchEvent(new Event(STOP_PLAYBACK_EVENT_NAME));
  for (const audio of document.querySelectorAll("audio")) audio.pause();
}

/** Resolve a fresh token for each operation and reject a changed account before dispatch. */
export async function getAuthenticatedRpcClient(expectedSubject?: string) {
  const current = await getFreshAccountSession();
  if (!current || (expectedSubject !== undefined && current.user.id !== expectedSubject))
    throw new Error("Sign in to continue.");
  return createAppApiClient().createAuthenticatedRpcClient(current.access_token);
}

export function refreshPlaybackAuthorization(current: Session | null = sessionSnapshot()) {
  const generation = sessionGeneration;
  const update = mediaUpdates
    .catch(() => undefined)
    .then(async () => {
      if (!current || isSigningOut || generation !== sessionGeneration) return undefined;
      const latest = await getFreshAccountSession();
      if (!latest || isSigningOut || generation !== sessionGeneration) return undefined;
      const response = await createAppApiClient()
        .createAuthenticatedRpcClient(latest.access_token)
        .createFilesSession();
      if (!response.ok) {
        stopPlayback();
        throw new Error("Sign in again to continue playback.");
      }
      if (isSigningOut || generation !== sessionGeneration) return undefined;
      await setNativeMediaSession(latest);
      return undefined;
    });
  mediaUpdates = update;
  return update;
}

export async function signOut() {
  isSigningOut = true;
  sessionGeneration += 1;
  publishSession(null);
  try {
    await finishSignOut();
  } finally {
    isSigningOut = false;
  }
}

async function finishSignOut() {
  stopPlayback();
  for (const audio of document.querySelectorAll("audio")) {
    audio.removeAttribute("src");
    for (const source of audio.querySelectorAll("source")) source.removeAttribute("src");
    audio.load();
  }
  const client = await ensureAuthInitialized();
  const response = await client.auth.signOut({ scope: "local" });
  await client.auth.stopAutoRefresh();
  await clearStoredSession?.();
  trialBrowserState.clearLastGrantId();
  // A late POST response may set a cookie; deletion must follow all prior issuance.
  await mediaUpdates.catch(() => undefined);
  await createAppApiClient()
    .clearFilesSession()
    .catch(() => undefined);
  await clearNativeAuthSession();
  if (response.error)
    throw new Error("Signed out on this device. Server session revocation could not be confirmed.");
}
