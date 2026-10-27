import { expect, test } from "@playwright/test";
import { AuthError, type AuthChangeEvent, type Session } from "@supabase/supabase-js";
import { createActor, fromPromise, waitFor, type EventFromLogic } from "xstate";

import {
  accountSessionMachine,
  selectAuthState,
  type AccountAuthClient,
  type AccountAuthConnection,
  type Reply,
} from "#src/auth/account-session-machine.ts";
import { ACCOUNT_SESSION_STORAGE_KEY } from "#src/auth/account-session-storage.ts";

test.use({ serviceWorkers: "block" });

test("auth distinguishes loading, failure, and successful signed-out initialization", async ({
  page,
}) => {
  await page.route("**/api/auth/config", (route) => route.fulfill({ status: 503 }));
  await page.goto("/ui-gallery/index.html");
  expect(
    await page.evaluate(async () => {
      const modulePath = "/src/auth/account-session.ts";
      const sessions = await import(modulePath);
      const initial = sessions.authStateSnapshot().status;
      await sessions.ensureAuthInitialized().catch(() => undefined);
      return { initial, failed: sessions.authStateSnapshot().status };
    }),
  ).toEqual({ initial: "loading", failed: "error" });
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        supabaseUrl: "https://auth.example.com",
        publishableKey: "test-key",
        googleWebClientId: "test-client",
      },
    }),
  );
  expect(
    await page.evaluate(async () => {
      const modulePath = "/src/auth/account-session.ts";
      const sessions = await import(modulePath);
      await sessions.ensureAuthInitialized();
      let notifications = 0;
      const unsubscribe = sessions.subscribeAuthState(() => {
        notifications += 1;
      });
      await sessions.getFreshAccountSession();
      await sessions.getFreshAccountSession();
      unsubscribe();
      return { status: sessions.authStateSnapshot().status, notifications };
    }),
  ).toEqual({ status: "signed-out", notifications: 0 });
});

test("concurrent session reads share an SDK refresh and cannot restore a signed-out session", async ({
  page,
}) => {
  let releaseRefresh: (() => void) | undefined;
  const refreshHeld = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let markRefreshStarted: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  let refreshRequests = 0;
  const subject = "f355f913-ba12-45d6-a7d2-4df95f7cf11f";
  const accessToken = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: subject, exp: 4294967295 })).toString("base64url")}.signature`;
  const storedSession = {
    access_token: accessToken,
    refresh_token: "test-refresh",
    token_type: "bearer",
    expires_at: 4294967295,
    expires_in: 300,
    user: { id: subject },
  };
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        supabaseUrl: "https://auth.example.com",
        publishableKey: "test-key",
        googleWebClientId: "test-client",
      },
    }),
  );
  await page.route("https://auth.example.com/auth/v1/token**", async (route) => {
    refreshRequests += 1;
    markRefreshStarted?.();
    await refreshHeld;
    await route.fulfill({ json: storedSession });
  });
  await page.route("https://auth.example.com/auth/v1/logout**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto("/ui-gallery/index.html");
  await page.evaluate(
    async ({ storageKey, stored }) => {
      localStorage.setItem(storageKey, JSON.stringify(stored));
      const modulePath = "/src/auth/account-session.ts";
      const sessions = await import(modulePath);
      const client = await sessions.ensureAuthInitialized();
      await client.auth.stopAutoRefresh();
      localStorage.setItem(storageKey, JSON.stringify({ ...stored, expires_at: 1 }));
      Object.assign(window, {
        pendingReads: Promise.all([
          sessions.getFreshAccountSession(),
          sessions.getFreshAccountSession(),
        ]),
      });
    },
    { storageKey: ACCOUNT_SESSION_STORAGE_KEY, stored: storedSession },
  );
  await refreshStarted;
  await page.evaluate(async () => {
    const modulePath = "/src/auth/account-session.ts";
    const sessions = await import(modulePath);
    Object.assign(window, { pendingLogout: sessions.signOut() });
  });
  releaseRefresh?.();
  expect(
    await page.evaluate(async (storageKey) => {
      if (!("pendingLogout" in window) || !("pendingReads" in window)) {
        throw new Error("Missing pending auth operations");
      }
      await window.pendingLogout;
      const reads = await window.pendingReads;
      const modulePath = "/src/auth/account-session.ts";
      const sessions = await import(modulePath);
      return {
        reads,
        stored: localStorage.getItem(storageKey),
        state: sessions.authStateSnapshot().status,
      };
    }, ACCOUNT_SESSION_STORAGE_KEY),
  ).toEqual({ reads: [null, null], stored: null, state: "signed-out" });
  expect(refreshRequests).toBe(1);
});

// The tests below drive the lifecycle machine directly, with fakes for Supabase, the platform, the
// query cache, and playback, to cover results that arrive after the session they belong to ended.

function createSession(subject: string): Session {
  return {
    access_token: `token-${subject}`,
    refresh_token: `refresh-${subject}`,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: subject,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "",
    },
  };
}

function toSessionResult(session: Session | null) {
  return session ? { data: { session }, error: null } : { data: { session: null }, error: null };
}

function startMachine({
  restored = null,
  revocationError = null,
  connectionError = null,
}: {
  restored?: Session | null;
  revocationError?: AuthError | null;
  connectionError?: Error | null;
} = {}) {
  const effects: string[] = [];
  const authListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const pendingSessionReads: Array<(session: Session | null) => void> = [];
  const pendingRevocations: Array<() => void> = [];
  const pendingSignIns: Array<() => void> = [];
  const fakes = {
    session: restored,
    shouldHoldSessionReads: false,
    shouldHoldRevocations: false,
    shouldHoldSignIns: false,
  };

  const fakeAuth: AccountAuthClient["auth"] = {
    getSession: async () => {
      if (!fakes.shouldHoldSessionReads) {
        return toSessionResult(fakes.session);
      }
      const session = await new Promise<Session | null>((resolve) => {
        pendingSessionReads.push(resolve);
      });
      return toSessionResult(session);
    },
    onAuthStateChange: (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
      authListeners.add(listener);
      const unsubscribe = () => {
        authListeners.delete(listener);
      };
      return { data: { subscription: { id: "fake", callback: listener, unsubscribe } } };
    },
    signOut: async () => {
      effects.push("supabase.signOut");
      if (fakes.shouldHoldRevocations) {
        await new Promise<void>((resolve) => {
          pendingRevocations.push(resolve);
        });
      }
      fakes.session = null;
      return { error: revocationError };
    },
    startAutoRefresh: async () => {
      effects.push("supabase.startAutoRefresh");
    },
    stopAutoRefresh: async () => {
      effects.push("supabase.stopAutoRefresh");
    },
  };
  const connection: AccountAuthConnection = {
    client: { auth: fakeAuth },
    signInMethods: ["google"],
    signIn: async ({ method, fresh }) => {
      effects.push(`signIn(${method}, fresh: ${String(fresh)})`);
      if (fakes.shouldHoldSignIns) {
        await new Promise<void>((resolve) => {
          pendingSignIns.push(resolve);
        });
      }
    },
    clearStoredSession: async () => {
      effects.push("clearStoredSession");
    },
  };

  const actor = createActor(
    accountSessionMachine.provide({
      actors: {
        loadConnection: fromPromise(async () => {
          if (connectionError) {
            throw connectionError;
          }
          return connection;
        }),
        clearNativeSignIn: fromPromise(async () => {
          effects.push("clearNativeSignIn");
        }),
      },
      actions: {
        clearQueries: () => effects.push("clearQueries"),
        stopPlayback: () => effects.push("stopPlayback"),
        unloadAudio: () => effects.push("unloadAudio"),
        clearLastGrantId: () => effects.push("clearLastGrantId"),
      },
    }),
  );
  actor.start();

  const request = <Value>(createEvent: (reply: Reply<Value>) => AccountSessionEvent) =>
    new Promise<Value>((resolve, reject) => actor.send(createEvent({ resolve, reject })));

  return {
    actor,
    effects,
    fakes,
    authListeners,
    pendingSessionReads,
    pendingRevocations,
    pendingSignIns,
    initialize: async () => {
      actor.send({ type: "INITIALIZE" });
      await waitFor(actor, (snapshot) => snapshot.hasTag("initialized"));
      effects.length = 0;
    },
    emitAuthChange: (session: Session | null) => {
      fakes.session = session;
      for (const listener of authListeners) {
        listener(session ? "SIGNED_IN" : "SIGNED_OUT", session);
      }
    },
    readSession: () => request<Session | null>((reply) => ({ type: "READ_SESSION", reply })),
    signIn: (fresh = false) =>
      request<void>((reply) => ({
        type: "SIGN_IN",
        request: { method: "google", fresh },
        reply,
      })),
    signOut: () => request<void>((reply) => ({ type: "SIGN_OUT", reply })),
  };
}

type AccountSessionEvent = EventFromLogic<typeof accountSessionMachine>;

/**
 * Lets fake promises settle and the machine take the transitions they cause. Each await in a fake
 * and each actor completion costs a microtask; the longest chain in these tests needs fewer than
 * ten.
 */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

test("initial restoration keeps cached queries and forgets the remembered trial", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  machine.actor.send({ type: "INITIALIZE" });
  const snapshot = await waitFor(machine.actor, (current) => current.hasTag("initialized"));

  expect(selectAuthState(snapshot)).toMatchObject({ status: "signed-in" });
  expect(machine.effects).toEqual(["stopPlayback", "clearLastGrantId"]);
});

test("failed initialization is retryable", async () => {
  let attempts = 0;
  const actor = createActor(
    accountSessionMachine.provide({
      actors: {
        loadConnection: fromPromise<AccountAuthConnection>(async () => {
          attempts += 1;
          throw new Error("Configuration unavailable");
        }),
      },
    }),
  );
  actor.start();

  expect(selectAuthState(actor.getSnapshot())).toEqual({ status: "loading" });
  actor.send({ type: "INITIALIZE" });
  const failed = await waitFor(actor, (current) => current.matches("error"));
  expect(selectAuthState(failed)).toMatchObject({ status: "error" });

  actor.send({ type: "INITIALIZE" });
  expect(selectAuthState(actor.getSnapshot())).toEqual({ status: "loading" });
  await waitFor(actor, (current) => current.matches("error"));
  expect(attempts).toBe(2);
});

test("a session read in flight when another account replaces the signed-in one resolves to null", async () => {
  const machine = startMachine({ restored: createSession("first") });
  await machine.initialize();
  machine.fakes.shouldHoldSessionReads = true;

  const read = machine.readSession();
  await settle();
  machine.emitAuthChange(createSession("second"));
  machine.pendingSessionReads[0]?.(createSession("first"));

  expect(await read).toBeNull();
  expect(machine.effects).toEqual(["clearQueries", "stopPlayback", "clearLastGrantId"]);
  expect(selectAuthState(machine.actor.getSnapshot())).toMatchObject({
    status: "signed-in",
    session: { user: { id: "second" } },
  });
});

test("a session read in flight when sign-in starts resolves to null", async () => {
  const machine = startMachine();
  await machine.initialize();
  machine.fakes.shouldHoldSessionReads = true;

  const read = machine.readSession();
  await settle();
  const signIn = machine.signIn(true);
  machine.pendingSessionReads[0]?.(createSession("previous"));

  expect(await read).toBeNull();
  await signIn;
  expect(machine.effects).toEqual([
    "stopPlayback",
    "supabase.startAutoRefresh",
    "signIn(google, fresh: true)",
  ]);
});

test("a session read in flight when sign-out starts resolves to null", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  await machine.initialize();
  machine.fakes.shouldHoldSessionReads = true;

  const read = machine.readSession();
  await settle();
  const signOut = machine.signOut();
  machine.pendingSessionReads[0]?.(createSession("reader"));

  expect(await read).toBeNull();
  await signOut;
  machine.fakes.shouldHoldSessionReads = false;
  expect(await machine.readSession()).toBeNull();
});

test("an account session reported during sign-in signs in without clearing queries", async () => {
  const machine = startMachine();
  await machine.initialize();

  const signIn = machine.signIn();
  machine.emitAuthChange(createSession("reader"));
  await signIn;
  // The sign-in actor settles the caller's reply before the machine takes its completion.
  await settle();

  expect(machine.effects).toEqual([
    "stopPlayback",
    "supabase.startAutoRefresh",
    "stopPlayback",
    "clearLastGrantId",
    "signIn(google, fresh: false)",
  ]);
  expect(machine.actor.getSnapshot().matches({ connected: { ready: "signedIn" } })).toBe(true);
});

test("sign-out shows signed-out at once, then revokes the session and ends the native sign-in", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  await machine.initialize();
  machine.fakes.shouldHoldRevocations = true;

  const signOut = machine.signOut();
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });
  await settle();
  expect(machine.effects).not.toContain("clearNativeSignIn");

  machine.pendingRevocations[0]?.();
  await signOut;
  expect(machine.effects).toEqual([
    "clearQueries",
    "stopPlayback",
    "unloadAudio",
    "supabase.signOut",
    "supabase.stopAutoRefresh",
    "clearStoredSession",
    "clearLastGrantId",
    "clearNativeSignIn",
  ]);
});

test("auth changes reported during sign-out are ignored", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  await machine.initialize();
  machine.fakes.shouldHoldRevocations = true;

  const signOut = machine.signOut();
  await settle();
  machine.emitAuthChange(createSession("reader"));
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });

  machine.pendingRevocations[0]?.();
  await signOut;
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });
});

test("sign-in is refused while signing out", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  await machine.initialize();
  machine.fakes.shouldHoldRevocations = true;

  const signOut = machine.signOut();

  await expect(machine.signIn()).rejects.toThrow("Wait for sign-out to finish before signing in.");
  machine.pendingRevocations[0]?.();
  await signOut;
});

test("sign-out reports a revocation the server did not confirm", async () => {
  const machine = startMachine({
    restored: createSession("reader"),
    revocationError: new AuthError("Network unavailable"),
  });
  await machine.initialize();

  await expect(machine.signOut()).rejects.toThrow(
    "Signed out on this device. Server session revocation could not be confirmed.",
  );
  expect(machine.effects).toContain("clearNativeSignIn");
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });
});

test("sign-out before initialization shows signed-out and stops audio before it initializes", async () => {
  const machine = startMachine({ restored: createSession("reader") });

  const signOut = machine.signOut();
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });
  expect(machine.effects).toEqual(["stopPlayback", "unloadAudio"]);

  await signOut;
  // The restored session is discarded rather than shown, so it does not stop playback again.
  expect(machine.effects).toEqual([
    "stopPlayback",
    "unloadAudio",
    "supabase.signOut",
    "supabase.stopAutoRefresh",
    "clearStoredSession",
    "clearLastGrantId",
    "clearNativeSignIn",
  ]);
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });
});

test("sign-out stops audio and reports the failure when initialization fails", async () => {
  const machine = startMachine({ connectionError: new Error("Configuration unavailable") });

  const signOut = machine.signOut();
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });

  await expect(signOut).rejects.toThrow("Configuration unavailable");
  expect(machine.effects).toEqual(["stopPlayback", "unloadAudio"]);
  expect(selectAuthState(machine.actor.getSnapshot())).toMatchObject({ status: "error" });
});

test("the auth change subscription lasts across sign-in, account switches, and sign-out", async () => {
  const machine = startMachine();
  await machine.initialize();
  expect(machine.authListeners.size).toBe(1);
  const [listener] = machine.authListeners;

  machine.emitAuthChange(createSession("first"));
  machine.emitAuthChange(createSession("second"));
  await machine.signOut();

  expect([...machine.authListeners]).toEqual([listener]);
});

test("a sign-in interrupted by sign-out settles when the provider call finishes", async () => {
  const machine = startMachine();
  await machine.initialize();
  machine.fakes.shouldHoldSignIns = true;

  let isSignInSettled = false;
  const signIn = machine.signIn().finally(() => {
    isSignInSettled = true;
  });
  await settle();
  await machine.signOut();
  await settle();
  expect(isSignInSettled).toBe(false);

  machine.pendingSignIns[0]?.();
  await signIn;
});
