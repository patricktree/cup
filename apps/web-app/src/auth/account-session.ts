import { createClient, type Session } from "@supabase/supabase-js";
import { createActor, fromPromise, waitFor } from "xstate";

import { parseOkResponse } from "@cup/listener-api.client";
import { authConfigResponseSchema } from "@cup/listener-api.routes";

import { createListenerApiClient } from "#src/api-client.js";
import {
  accountSessionMachine,
  selectAuthState,
  type AccountAuthClient,
  type AccountAuthConnection,
  type AccountAuthState,
  type Reply,
  type SignInMethod,
} from "#src/auth/account-session-machine.js";
import {
  ACCOUNT_SESSION_CODE_VERIFIER_STORAGE_KEY,
  ACCOUNT_SESSION_STORAGE_KEY,
} from "#src/auth/account-session-storage.js";
import { queryClient } from "#src/data-fetching/query-client.js";
import {
  initializeAuthStorage,
  signInWithGoogle,
  clearNativeSignIn,
} from "#src/platform/account-auth.js";
import { STOP_PLAYBACK_EVENT_NAME } from "#src/playback-events.js";
import { trialBrowserState } from "#src/trial-browser-state.js";

export type { SignInMethod };

/*
 * A thin facade over the account session actor: callers and route loaders keep a promise-based API
 * while the lifecycle, including which async results are still current, lives in the machine.
 */
const accountSessionActor = createActor(
  accountSessionMachine.provide({
    actors: {
      loadConnection: fromPromise(loadConnection),
      clearNativeSignIn: fromPromise(clearNativeSignIn),
    },
    actions: {
      clearQueries: () => queryClient.clear(),
      stopPlayback,
      unloadAudio,
      clearLastGrantId: () => trialBrowserState.clearLastGrantId(),
    },
  }),
);
accountSessionActor.start();

let publishedAuthState = selectAuthState(accountSessionActor.getSnapshot());

/** Returns the same object until the shown state changes, as `useSyncExternalStore` requires. */
export const authStateSnapshot = (): AccountAuthState => {
  const next = selectAuthState(accountSessionActor.getSnapshot());
  if (!isSameAuthState(publishedAuthState, next)) {
    publishedAuthState = next;
  }
  return publishedAuthState;
};
export const sessionSnapshot = () => {
  const state = authStateSnapshot();
  return state.status === "signed-in" ? state.session : null;
};
/** Whether `subject` is still the signed-in account, e.g. before applying a late response. */
export const isSignedInAs = (subject: string) => sessionSnapshot()?.user.id === subject;
const DEFAULT_SIGN_IN_METHODS: readonly SignInMethod[] = ["google"];
/** The sign-in methods the auth configuration offers; Google until account auth initializes. */
export const signInMethodsSnapshot = () =>
  accountSessionActor.getSnapshot().context.connection?.signInMethods ?? DEFAULT_SIGN_IN_METHODS;
/** Notifies `listener` when the shown auth state changes, not on every machine transition. */
export const subscribeAuthState = (listener: () => void) => {
  let last = authStateSnapshot();
  const subscription = accountSessionActor.subscribe(() => {
    const next = authStateSnapshot();
    if (next !== last) {
      last = next;
      listener();
    }
  });
  return () => subscription.unsubscribe();
};

export async function ensureAuthInitialized(): Promise<AccountAuthClient> {
  accountSessionActor.send({ type: "INITIALIZE" });
  const snapshot = await waitFor(
    accountSessionActor,
    (current) => current.hasTag("initialized") || current.matches("error"),
  );
  const state = selectAuthState(snapshot);
  if (state.status === "error") {
    throw state.error;
  }
  if (!snapshot.context.connection) {
    throw new Error("Account auth finished initializing without a connection.");
  }
  return snapshot.context.connection.client;
}

/** Resolves to `null` when the session scope ends before the read finishes, e.g. on sign-out. */
export async function getFreshAccountSession(): Promise<Session | null> {
  await ensureAuthInitialized();
  return request<Session | null>((reply) =>
    accountSessionActor.send({ type: "READ_SESSION", reply }),
  );
}

/** Grant-session access must not depend on account auth initializing when no account is signed in. */
export async function getResourceAccountSession() {
  try {
    return await getFreshAccountSession();
  } catch (error) {
    if (sessionSnapshot()) {
      throw error;
    }
    return null;
  }
}

/** Refused while signing out or while another sign-in is in progress. */
export async function signIn(method: SignInMethod) {
  await ensureAuthInitialized();
  return request<void>((reply) =>
    accountSessionActor.send({ type: "SIGN_IN", request: { method, fresh: false }, reply }),
  );
}

/** Authenticates the signed-in account again, with the method its session came from. */
export async function signInAgain() {
  await ensureAuthInitialized();
  const method: SignInMethod =
    sessionSnapshot()?.user.app_metadata.provider === "email" ? "test-account" : "google";
  return request<void>((reply) =>
    accountSessionActor.send({ type: "SIGN_IN", request: { method, fresh: true }, reply }),
  );
}

/**
 * Shows signed-out and stops audio immediately, then initializes account auth if needed to clear
 * the stored session. Concurrent calls share one sign-out.
 */
export function signOut() {
  return request<void>((reply) => accountSessionActor.send({ type: "SIGN_OUT", reply }));
}

async function loadConnection(): Promise<AccountAuthConnection> {
  const config = authConfigResponseSchema.parse(
    await parseOkResponse(createListenerApiClient().getAuthConfig()),
  );
  const platformStorage = await initializeAuthStorage([
    ACCOUNT_SESSION_STORAGE_KEY,
    ACCOUNT_SESSION_CODE_VERIFIER_STORAGE_KEY,
  ]);
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
  const { testAccount } = config;
  const signInMethods: SignInMethod[] = [];
  if (config.googleWebClientId) {
    signInMethods.push("google");
  }
  if (testAccount) {
    signInMethods.push("test-account");
  }
  return {
    client,
    signInMethods,
    signIn: async ({ method, fresh }) => {
      if (method === "google") {
        await signInWithGoogle(client, config.googleWebClientId, fresh);
        return;
      }
      if (!testAccount) {
        throw new Error("Sign-in is temporarily unavailable.");
      }
      // A password sign-in always authenticates again, so it is fresh either way.
      const result = await client.auth.signInWithPassword(testAccount);
      if (result.error) {
        throw result.error;
      }
    },
    clearStoredSession: platformStorage.clearStoredSession,
  };
}

function request<Value>(send: (reply: Reply<Value>) => void) {
  return new Promise<Value>((resolve, reject) => send({ resolve, reject }));
}

function isSameAuthState(previous: AccountAuthState, next: AccountAuthState) {
  if (previous.status !== next.status) {
    return false;
  }
  if (previous.status === "signed-in" && next.status === "signed-in") {
    return previous.session === next.session;
  }
  if (previous.status === "error" && next.status === "error") {
    return previous.error === next.error;
  }
  return true;
}

function stopPlayback() {
  window.dispatchEvent(new Event(STOP_PLAYBACK_EVENT_NAME));
  for (const audio of document.querySelectorAll("audio")) {
    audio.pause();
  }
}

function unloadAudio() {
  for (const audio of document.querySelectorAll("audio")) {
    audio.removeAttribute("src");
    for (const source of audio.querySelectorAll("source")) {
      source.removeAttribute("src");
    }
    audio.load();
  }
}
