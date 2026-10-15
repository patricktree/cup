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

test("logout clears a cookie issued by an earlier pending media request", async ({ page }) => {
  let releaseIssuance: (() => void) | undefined;
  const issuanceHeld = new Promise<void>((resolve) => {
    releaseIssuance = resolve;
  });
  let markStarted: (() => void) | undefined;
  const issuanceStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        supabaseUrl: "https://auth.example.com",
        publishableKey: "test-key",
        googleWebClientId: "test-client",
      },
    }),
  );
  await page.route("https://auth.example.com/auth/v1/logout**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/files/session", async (route) => {
    if (route.request().method() === "POST") {
      markStarted?.();
      await issuanceHeld;
      await route.fulfill({
        status: 204,
        headers: {
          "Set-Cookie": "cup_media=old-session; Path=/api/files; HttpOnly; SameSite=Lax",
        },
      });
    } else {
      await route.fulfill({
        status: 204,
        headers: {
          "Set-Cookie": "cup_media=; Path=/api/files; Max-Age=0; HttpOnly; SameSite=Lax",
        },
      });
    }
  });
  await page.goto("/ui-gallery/index.html");
  await page.evaluate(async (storageKey) => {
    const payload = btoa(
      JSON.stringify({ sub: "f355f913-ba12-45d6-a7d2-4df95f7cf11f", exp: 4294967295 }),
    ).replaceAll("=", "");
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`,
        refresh_token: "test-refresh",
        token_type: "bearer",
        expires_at: 4294967295,
        expires_in: 300,
        user: { id: "f355f913-ba12-45d6-a7d2-4df95f7cf11f" },
      }),
    );
    const modulePath = "/src/auth/account-session.ts";
    const sessions = await import(modulePath);
    await sessions.ensureAuthInitialized();
    Object.assign(window, { pendingIssuance: sessions.refreshPlaybackAuthorization() });
  }, ACCOUNT_SESSION_STORAGE_KEY);
  await issuanceStarted;
  await page.evaluate(async () => {
    const modulePath = "/src/auth/account-session.ts";
    const sessions = await import(modulePath);
    Object.assign(window, { pendingLogout: sessions.signOut() });
  });
  releaseIssuance?.();
  await page.evaluate(async () => {
    if (!("pendingLogout" in window)) {
      throw new Error("Missing pending logout");
    }
    await window.pendingLogout;
  });
  expect((await page.context().cookies()).filter((cookie) => cookie.name === "cup_media")).toEqual(
    [],
  );
  expect(
    await page.evaluate(async (storageKey) => {
      const modulePath = "/src/auth/account-session.ts";
      const sessions = await import(modulePath);
      return {
        session: sessions.sessionSnapshot(),
        stored: localStorage.getItem(storageKey),
      };
    }, ACCOUNT_SESSION_STORAGE_KEY),
  ).toEqual({ session: null, stored: null });
});

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
  await page.route("**/api/files/session", (route) => route.fulfill({ status: 204 }));
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
}: { restored?: Session | null; revocationError?: AuthError | null } = {}) {
  const effects: string[] = [];
  const authListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const pendingSessionReads: Array<(session: Session | null) => void> = [];
  const pendingMediaCookies: Array<(result: { isAccepted: boolean }) => void> = [];
  const fakes = { session: restored, shouldHoldSessionReads: false, shouldHoldMediaCookies: false };

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
    signInWithGoogle: async (fresh) => {
      effects.push(`signInWithGoogle(fresh: ${String(fresh)})`);
    },
    clearStoredSession: async () => {
      effects.push("clearStoredSession");
    },
  };

  const actor = createActor(
    accountSessionMachine.provide({
      actors: {
        loadConnection: fromPromise(async () => connection),
        registerResumeListener: fromPromise<void>(async () => {}),
        createMediaCookie: fromPromise(async ({ input }) => {
          effects.push(`createMediaCookie(${input.session.user.id})`);
          if (!fakes.shouldHoldMediaCookies) {
            return { isAccepted: true };
          }
          return new Promise<{ isAccepted: boolean }>((resolve) => {
            pendingMediaCookies.push(resolve);
          });
        }),
        installNativeMediaSession: fromPromise(async ({ input }) => {
          effects.push(`installNativeMediaSession(${input.session.user.id})`);
        }),
        clearMediaSessions: fromPromise(async () => {
          effects.push("clearMediaSessions");
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
    pendingMediaCookies,
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
    signIn: (fresh = false) => request<void>((reply) => ({ type: "SIGN_IN", fresh, reply })),
    signOut: () => request<void>((reply) => ({ type: "SIGN_OUT", reply })),
    authorizeMedia: () => request<void>((reply) => ({ type: "AUTHORIZE_MEDIA", reply })),
  };
}

type AccountSessionEvent = EventFromLogic<typeof accountSessionMachine>;

/** Lets fake promises settle and the machine take the transitions they cause. */
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
  const failed = await waitFor(actor, (current) => current.matches({ session: "error" }));
  expect(selectAuthState(failed)).toMatchObject({ status: "error" });

  actor.send({ type: "INITIALIZE" });
  expect(selectAuthState(actor.getSnapshot())).toEqual({ status: "loading" });
  await waitFor(actor, (current) => current.matches({ session: "error" }));
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
    "signInWithGoogle(fresh: true)",
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

  expect(machine.effects).toEqual([
    "stopPlayback",
    "supabase.startAutoRefresh",
    "stopPlayback",
    "clearLastGrantId",
    "signInWithGoogle(fresh: false)",
  ]);
  expect(machine.actor.getSnapshot().matches({ session: { ready: "signedIn" } })).toBe(true);
});

test("sign-out runs its steps in order after the in-flight media cookie issuance", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  await machine.initialize();
  machine.fakes.shouldHoldMediaCookies = true;

  const issuance = machine.authorizeMedia();
  await settle();
  const signOut = machine.signOut();
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });
  await settle();
  expect(machine.effects).not.toContain("clearMediaSessions");

  machine.pendingMediaCookies[0]?.({ isAccepted: true });
  await Promise.all([issuance, signOut]);
  expect(machine.effects).toEqual([
    "createMediaCookie(reader)",
    "clearQueries",
    "stopPlayback",
    "unloadAudio",
    "supabase.signOut",
    "supabase.stopAutoRefresh",
    "clearStoredSession",
    "clearLastGrantId",
    "clearMediaSessions",
  ]);
});

test("auth changes reported during sign-out are ignored", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  await machine.initialize();
  machine.fakes.shouldHoldMediaCookies = true;

  const issuance = machine.authorizeMedia();
  await settle();
  const signOut = machine.signOut();
  expect(machine.authListeners.size).toBe(0);
  machine.emitAuthChange(createSession("reader"));
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });

  machine.fakes.session = null;
  machine.pendingMediaCookies[0]?.({ isAccepted: true });
  await Promise.all([issuance, signOut]);
});

test("sign-in is refused while signing out", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  await machine.initialize();
  machine.fakes.shouldHoldMediaCookies = true;

  const issuance = machine.authorizeMedia();
  await settle();
  const signOut = machine.signOut();

  await expect(machine.signIn()).rejects.toThrow("Wait for sign-out to finish before signing in.");
  machine.pendingMediaCookies[0]?.({ isAccepted: true });
  await Promise.all([issuance, signOut]);
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
  expect(machine.effects).toContain("clearMediaSessions");
  expect(selectAuthState(machine.actor.getSnapshot())).toEqual({ status: "signed-out" });
});

test("media cookie issuance is serialized and a stale issuance does not install its session", async () => {
  const machine = startMachine({ restored: createSession("first") });
  await machine.initialize();
  machine.fakes.shouldHoldMediaCookies = true;

  const inFlight = machine.authorizeMedia();
  const queued = machine.authorizeMedia();
  await settle();
  expect(machine.pendingMediaCookies).toHaveLength(1);

  machine.emitAuthChange(createSession("second"));
  await queued;
  const afterSwitch = machine.authorizeMedia();
  await settle();
  // The new account's request waits for the response to the earlier one.
  expect(machine.pendingMediaCookies).toHaveLength(1);

  machine.pendingMediaCookies[0]?.({ isAccepted: true });
  await inFlight;
  await settle();
  machine.pendingMediaCookies[1]?.({ isAccepted: true });
  await afterSwitch;

  expect(machine.effects.filter((effect) => effect.includes("Media"))).toEqual([
    "createMediaCookie(first)",
    "createMediaCookie(second)",
    "installNativeMediaSession(second)",
  ]);
});

test("a rejected media cookie stops playback", async () => {
  const machine = startMachine({ restored: createSession("reader") });
  await machine.initialize();
  machine.fakes.shouldHoldMediaCookies = true;

  const issuance = machine.authorizeMedia();
  await settle();
  machine.pendingMediaCookies[0]?.({ isAccepted: false });

  await expect(issuance).rejects.toThrow("Sign in again to continue playback.");
  expect(machine.effects).toEqual(["createMediaCookie(reader)", "stopPlayback"]);
});

test("media authorization without a signed-in account does nothing", async () => {
  const machine = startMachine();
  await machine.initialize();

  await machine.authorizeMedia();
  expect(machine.effects).toEqual([]);
});
