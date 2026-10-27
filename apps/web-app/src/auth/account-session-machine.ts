import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  assertEvent,
  assign,
  enqueueActions,
  fromCallback,
  fromPromise,
  raise,
  sendTo,
  setup,
  stateIn,
  type SnapshotFrom,
} from "xstate";

/** Settles the promise that a caller of the account session facade awaits for one request. */
export type Reply<Value> = {
  resolve: (value: Value) => void;
  reject: (error: unknown) => void;
};

/** The Supabase auth methods the machine calls itself; tests fake exactly these. */
export type AccountAuthClient = {
  auth: Pick<
    SupabaseClient["auth"],
    "getSession" | "onAuthStateChange" | "signOut" | "startAutoRefresh" | "stopAutoRefresh"
  >;
};

/** Google everywhere; the test account only where local development advertises it. */
export type SignInMethod = "google" | "test-account";
/** A fresh sign-in authenticates again even when the provider still has a session. */
export type SignInRequest = { method: SignInMethod; fresh: boolean };

/** What initialization produces: the Supabase client and the platform operations bound to it. */
export type AccountAuthConnection = {
  client: AccountAuthClient;
  /** The methods the auth configuration offers, in the order the sign-in dialog shows them. */
  signInMethods: readonly SignInMethod[];
  signIn: (request: SignInRequest) => Promise<void>;
  clearStoredSession: () => Promise<void>;
};

export type AccountAuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; session: Session }
  | { status: "error"; error: Error };

export type AccountSessionSnapshot = SnapshotFrom<typeof accountSessionMachine>;

const SIGN_IN_UNAVAILABLE = new Error("Sign-in is temporarily unavailable.");
const NOT_INITIALIZED_MESSAGE = "Account auth is not initialized.";

const INITIAL_CONTEXT: AccountSessionContext = {
  connection: undefined,
  session: null,
  initializationError: undefined,
  signIn: undefined,
  signOutReplies: [],
  isRevocationConfirmed: false,
  mediaRequests: [],
  mediaSession: undefined,
};

/**
 * The account auth lifecycle of the web app.
 *
 * The `session` region moves through uninitialized → initializing → connected, with a retryable
 * `error` state when initialization fails. `connected` subscribes to Supabase auth changes once and
 * alternates between ready (signedOut ⇄ signingIn → signedIn) and signingOut. A sign-out requested
 * before initialization finishes is queued and runs as soon as the client is connected. `ready` is
 * one session scope: its session reads stop when the scope ends, which happens when a sign-in
 * starts, a sign-out starts, or a signed-in subject changes. A read that is still in flight then
 * resolves to `null` instead of returning a stale session.
 *
 * The parallel `mediaAuthorization` region serializes media cookie issuance across scopes. Ending a
 * scope discards queued requests and the result of the one in flight, but the region still waits
 * for that request's response so sign-out can clear media sessions after every cookie the server
 * issued.
 *
 * Effects that touch the network, the platform, the query cache, or playback are placeholders here;
 * `account-session.ts` provides them through `machine.provide(...)` and tests provide fakes.
 */
export const accountSessionMachine = setup({
  // `setup` reads the types from these values; it does not use them at runtime.
  types: { context: INITIAL_CONTEXT, events: eventTypeWitness() },
  actors: {
    loadConnection: fromPromise<AccountAuthConnection>(() =>
      Promise.reject(missingImplementation("loadConnection")),
    ),
    registerResumeListener: fromPromise<void, { onResume: () => void }>(() =>
      Promise.reject(missingImplementation("registerResumeListener")),
    ),
    createMediaCookie: fromPromise<{ isAccepted: boolean }, { session: Session }>(() =>
      Promise.reject(missingImplementation("createMediaCookie")),
    ),
    installNativeMediaSession: fromPromise<void, { session: Session }>(() =>
      Promise.reject(missingImplementation("installNativeMediaSession")),
    ),
    clearMediaSessions: fromPromise<void>(() =>
      Promise.reject(missingImplementation("clearMediaSessions")),
    ),
    readSession: fromPromise<Session | null, { client: AccountAuthClient }>(async ({ input }) =>
      readSession(input.client),
    ),
    watchSessionChanges: fromCallback<AccountSessionEvent, { client: AccountAuthClient }>(
      ({ input, sendBack }) => {
        const { data } = input.client.auth.onAuthStateChange((_event, session) => {
          sendBack({ type: "SESSION_CHANGED", session });
        });
        return () => data.subscription.unsubscribe();
      },
    ),
    sessionReads: fromCallback<ReadSessionEvent, { client: AccountAuthClient }>(
      ({ input, receive }) => {
        const pendingReplies = new Set<Reply<Session | null>>();
        receive(({ reply }) => {
          pendingReplies.add(reply);
          void settleRead(input.client, reply, pendingReplies);
        });
        // The session scope ended while these reads were in flight: their result may belong to an
        // account that is no longer signed in.
        return () => {
          for (const reply of pendingReplies) {
            reply.resolve(null);
          }
          pendingReplies.clear();
        };
      },
    ),
    // The provider call cannot be recalled, so the caller learns its real outcome even when the
    // session scope ends first and this actor is stopped.
    signIn: fromPromise<
      void,
      { connection: AccountAuthConnection; request: SignInRequest; reply: Reply<void> }
    >(async ({ input }) => {
      try {
        await input.connection.client.auth.startAutoRefresh();
        await input.connection.signIn(input.request);
        input.reply.resolve();
      } catch (error) {
        input.reply.reject(error);
        throw error;
      }
    }),
    revokeSession: fromPromise<{ isRevocationConfirmed: boolean }, AccountAuthConnection>(
      async ({ input }) => {
        const response = await input.client.auth.signOut({ scope: "local" });
        await input.client.auth.stopAutoRefresh();
        await input.clearStoredSession();
        return { isRevocationConfirmed: !response.error };
      },
    ),
  },
  actions: {
    clearQueries: () => {
      throw missingImplementation("clearQueries");
    },
    stopPlayback: () => {
      throw missingImplementation("stopPlayback");
    },
    unloadAudio: () => {
      throw missingImplementation("unloadAudio");
    },
    clearLastGrantId: () => {
      throw missingImplementation("clearLastGrantId");
    },
    assignSessionFromEvent: assign({
      session: ({ event }) => {
        assertEvent(event, "SESSION_CHANGED");
        return event.session;
      },
    }),
    forgetSignIn: assign({ signIn: undefined }),
    queueSignOut: assign({
      session: null,
      isRevocationConfirmed: false,
      signOutReplies: ({ context, event }) => {
        assertEvent(event, "SIGN_OUT");
        return [...context.signOutReplies, event.reply];
      },
    }),
    rejectSignOuts: ({ context }, params: { error: unknown }) =>
      rejectAll(context.signOutReplies, params.error),
    forgetSignOuts: assign({ signOutReplies: [] }),
    resolveCurrentMediaRequest: ({ context }) => context.mediaRequests[0]?.resolve(),
    rejectCurrentMediaRequest: ({ context }, params: { error: unknown }) =>
      context.mediaRequests[0]?.reject(params.error),
    dequeueMediaRequest: assign({
      mediaRequests: ({ context }) => context.mediaRequests.slice(1),
      mediaSession: undefined,
    }),
    resolveWaitingMediaRequests: ({ context }) => {
      for (const request of context.mediaRequests.slice(1)) {
        request.resolve();
      }
    },
    keepOnlyCurrentMediaRequest: assign({
      mediaRequests: ({ context }) => context.mediaRequests.slice(0, 1),
    }),
  },
  guards: {
    hasSession: ({ context }) => context.session !== null,
    hasQueuedSignOut: ({ context }) => context.signOutReplies.length > 0,
    isSameSubject: ({ context, event }) => {
      assertEvent(event, "SESSION_CHANGED");
      return (event.session?.user.id ?? null) === (context.session?.user.id ?? null);
    },
    startsSession: ({ context, event }) => {
      assertEvent(event, "SESSION_CHANGED");
      return context.session === null && event.session !== null;
    },
    hasMediaRequests: ({ context }) => context.mediaRequests.length > 0,
    isMediaAuthorizationIdle: stateIn("#accountSession.mediaAuthorization.idle"),
    isMediaCookieDiscarded: stateIn(
      "#accountSession.mediaAuthorization.issuing.creatingCookie.discarded",
    ),
  },
}).createMachine({
  id: "accountSession",
  type: "parallel",
  context: INITIAL_CONTEXT,
  states: {
    session: {
      initial: "uninitialized",
      // Fallbacks for states without a session scope. The facade initializes before it sends these.
      on: {
        // Sign-out is clearing the session, or there is none yet; there is no session to read.
        READ_SESSION: { actions: ({ event }) => event.reply.resolve(null) },
        SIGN_IN: {
          actions: ({ event }) => event.reply.reject(new Error(NOT_INITIALIZED_MESSAGE)),
        },
      },
      states: {
        uninitialized: {
          on: {
            INITIALIZE: "initializing",
            // Sign-out shows signed-out and stops audio before it waits for initialization.
            SIGN_OUT: {
              target: "initializing",
              actions: ["queueSignOut", "stopPlayback", "unloadAudio"],
            },
          },
        },
        initializing: {
          initial: "connecting",
          on: {
            SIGN_OUT: { actions: ["queueSignOut", "stopPlayback", "unloadAudio"] },
          },
          states: {
            connecting: {
              invoke: {
                src: "loadConnection",
                onDone: {
                  target: "listeningForAppResume",
                  actions: assign({ connection: ({ event }) => event.output }),
                },
                onError: {
                  target: "#accountSession.session.error",
                  actions: [
                    assign({ initializationError: ({ event }) => toError(event.error) }),
                    { type: "rejectSignOuts", params: ({ event }) => ({ error: event.error }) },
                    "forgetSignOuts",
                  ],
                },
              },
            },
            // Registered before the session is restored, so the restored state shows without
            // waiting for the platform.
            listeningForAppResume: {
              invoke: {
                src: "registerResumeListener",
                input: ({ self }) => ({ onResume: () => self.send({ type: "APP_RESUMED" }) }),
                onDone: "restoringSession",
                onError: {
                  target: "#accountSession.session.error",
                  actions: [
                    assign({ initializationError: ({ event }) => toError(event.error) }),
                    { type: "rejectSignOuts", params: ({ event }) => ({ error: event.error }) },
                    "forgetSignOuts",
                  ],
                },
              },
            },
            restoringSession: {
              invoke: {
                src: "readSession",
                input: ({ context }) => ({ client: requireConnection(context).client }),
                onDone: [
                  // A sign-out requested during initialization discards the restored session.
                  { guard: "hasQueuedSignOut", target: "#accountSession.session.connected" },
                  {
                    target: "#accountSession.session.connected",
                    // Route loaders can await the initial restoration, so it keeps cached queries.
                    actions: [
                      "stopPlayback",
                      enqueueActions(({ event, enqueue }) => {
                        if (event.output) {
                          enqueue("clearLastGrantId");
                        }
                      }),
                      assign({ session: ({ event }) => event.output }),
                    ],
                  },
                ],
                onError: {
                  target: "#accountSession.session.error",
                  actions: [
                    assign({ initializationError: ({ event }) => toError(event.error) }),
                    { type: "rejectSignOuts", params: ({ event }) => ({ error: event.error }) },
                    "forgetSignOuts",
                  ],
                },
              },
            },
          },
        },
        error: {
          on: {
            INITIALIZE: {
              target: "initializing",
              actions: assign({ initializationError: undefined }),
            },
            SIGN_OUT: {
              target: "initializing",
              actions: [
                assign({ initializationError: undefined }),
                "queueSignOut",
                "stopPlayback",
                "unloadAudio",
              ],
            },
          },
        },
        connected: {
          tags: ["initialized"],
          initial: "starting",
          // Subscribed once per client: auth changes reach only the states that handle them, so
          // changes reported during sign-out are ignored without unsubscribing.
          invoke: {
            src: "watchSessionChanges",
            input: ({ context }) => ({ client: requireConnection(context).client }),
          },
          states: {
            starting: {
              always: [{ guard: "hasQueuedSignOut", target: "signingOut" }, { target: "ready" }],
            },
            ready: {
              initial: "routing",
              invoke: {
                id: "sessionReads",
                src: "sessionReads",
                input: ({ context }) => ({ client: requireConnection(context).client }),
              },
              exit: raise({ type: "SESSION_SCOPE_ENDED" }),
              on: {
                READ_SESSION: { actions: sendTo("sessionReads", ({ event }) => event) },
                SESSION_CHANGED: [
                  { guard: "isSameSubject", actions: "assignSessionFromEvent" },
                  {
                    guard: "hasSession",
                    // A different subject, or none, replaces the signed-in account: end its scope.
                    target: "#accountSession.session.connected.ready",
                    reenter: true,
                    actions: [
                      "forgetSignIn",
                      "clearQueries",
                      "stopPlayback",
                      enqueueActions(({ event, enqueue }) => {
                        if (event.session) {
                          enqueue("clearLastGrantId");
                        }
                      }),
                      "assignSessionFromEvent",
                    ],
                  },
                ],
                SIGN_IN: {
                  target: ".signingIn",
                  reenter: true,
                  actions: [
                    "stopPlayback",
                    assign({
                      signIn: ({ event }) => ({ request: event.request, reply: event.reply }),
                    }),
                  ],
                },
                SIGN_OUT: {
                  target: "#accountSession.session.connected.signingOut",
                  actions: [
                    "forgetSignIn",
                    enqueueActions(({ context, enqueue }) => {
                      if (context.session) {
                        enqueue("clearQueries");
                      }
                    }),
                    "queueSignOut",
                    "stopPlayback",
                    "unloadAudio",
                  ],
                },
              },
              states: {
                routing: {
                  always: [{ guard: "hasSession", target: "signedIn" }, { target: "signedOut" }],
                },
                signedOut: {
                  on: {
                    SESSION_CHANGED: {
                      guard: "startsSession",
                      target: "signedIn",
                      actions: ["stopPlayback", "clearLastGrantId", "assignSessionFromEvent"],
                    },
                  },
                },
                signingIn: {
                  invoke: {
                    src: "signIn",
                    input: ({ context }) => ({
                      connection: requireConnection(context),
                      ...requireSignIn(context),
                    }),
                    // The actor settles the caller's reply itself.
                    onDone: { target: "routing", actions: "forgetSignIn" },
                    onError: { target: "routing", actions: "forgetSignIn" },
                  },
                  on: {
                    // Concurrent OAuth flows would overwrite each other's PKCE code verifier.
                    SIGN_IN: {
                      actions: ({ event }) =>
                        event.reply.reject(new Error("Wait for the current sign-in to finish.")),
                    },
                    SESSION_CHANGED: {
                      // The provider reports the new session before the sign-in call returns.
                      guard: "startsSession",
                      actions: ["stopPlayback", "clearLastGrantId", "assignSessionFromEvent"],
                    },
                  },
                },
                signedIn: {},
              },
            },
            signingOut: {
              initial: "revokingSession",
              on: {
                SIGN_IN: {
                  actions: ({ event }) =>
                    event.reply.reject(new Error("Wait for sign-out to finish before signing in.")),
                },
                // Joins the sign-out in progress; playback was stopped when it started.
                SIGN_OUT: { actions: "queueSignOut" },
              },
              states: {
                revokingSession: {
                  invoke: {
                    src: "revokeSession",
                    input: ({ context }) => requireConnection(context),
                    onDone: {
                      target: "awaitingMediaIssuance",
                      actions: [
                        assign({
                          isRevocationConfirmed: ({ event }) => event.output.isRevocationConfirmed,
                        }),
                        "clearLastGrantId",
                      ],
                    },
                    onError: {
                      target: "#accountSession.session.connected.ready",
                      actions: [
                        { type: "rejectSignOuts", params: ({ event }) => ({ error: event.error }) },
                        "forgetSignOuts",
                      ],
                    },
                  },
                },
                awaitingMediaIssuance: {
                  // A late issuance response may set a cookie; clearing must follow every prior issuance.
                  always: { guard: "isMediaAuthorizationIdle", target: "clearingMediaSessions" },
                },
                clearingMediaSessions: {
                  invoke: {
                    src: "clearMediaSessions",
                    onDone: {
                      target: "#accountSession.session.connected.ready",
                      actions: [
                        ({ context }) => {
                          if (context.isRevocationConfirmed) {
                            resolveAll(context.signOutReplies);
                          } else {
                            rejectAll(
                              context.signOutReplies,
                              new Error(
                                "Signed out on this device. Server session revocation could not be confirmed.",
                              ),
                            );
                          }
                        },
                        "forgetSignOuts",
                      ],
                    },
                    onError: {
                      target: "#accountSession.session.connected.ready",
                      actions: [
                        { type: "rejectSignOuts", params: ({ event }) => ({ error: event.error }) },
                        "forgetSignOuts",
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    mediaAuthorization: {
      initial: "idle",
      on: {
        AUTHORIZE_MEDIA: [
          {
            guard: "hasSession",
            actions: assign({
              mediaRequests: ({ context, event }) => [...context.mediaRequests, event.reply],
            }),
          },
          { actions: ({ event }) => event.reply.resolve() },
        ],
        // The app returns to the foreground: refresh the media cookie, which may have expired.
        APP_RESUMED: {
          guard: "hasSession",
          actions: assign({
            mediaRequests: ({ context, self }) => [
              ...context.mediaRequests,
              {
                resolve: () => undefined,
                reject: () => self.send({ type: "RESUMED_MEDIA_AUTHORIZATION_FAILED" }),
              },
            ],
          }),
        },
        RESUMED_MEDIA_AUTHORIZATION_FAILED: { actions: "stopPlayback" },
        SESSION_SCOPE_ENDED: {
          actions: ["resolveWaitingMediaRequests", "keepOnlyCurrentMediaRequest"],
        },
      },
      states: {
        idle: {
          always: { guard: "hasMediaRequests", target: "issuing" },
        },
        issuing: {
          initial: "readingSession",
          states: {
            readingSession: {
              invoke: {
                src: "readSession",
                input: ({ context }) => ({ client: requireConnection(context).client }),
                onDone: [
                  {
                    guard: ({ event }) => event.output === null,
                    target: "#accountSession.mediaAuthorization.idle",
                    actions: ["resolveCurrentMediaRequest", "dequeueMediaRequest"],
                  },
                  {
                    target: "creatingCookie",
                    actions: assign({ mediaSession: ({ event }) => event.output ?? undefined }),
                  },
                ],
                onError: {
                  target: "#accountSession.mediaAuthorization.idle",
                  actions: [
                    {
                      type: "rejectCurrentMediaRequest",
                      params: ({ event }) => ({ error: event.error }),
                    },
                    "dequeueMediaRequest",
                  ],
                },
              },
              on: {
                SESSION_SCOPE_ENDED: {
                  target: "#accountSession.mediaAuthorization.idle",
                  actions: [
                    "resolveWaitingMediaRequests",
                    "keepOnlyCurrentMediaRequest",
                    "resolveCurrentMediaRequest",
                    "dequeueMediaRequest",
                  ],
                },
              },
            },
            creatingCookie: {
              initial: "current",
              invoke: {
                src: "createMediaCookie",
                input: ({ context }) => ({ session: requireMediaSession(context) }),
                onDone: [
                  {
                    guard: ({ event }) => !event.output.isAccepted,
                    target: "#accountSession.mediaAuthorization.idle",
                    actions: [
                      "stopPlayback",
                      {
                        type: "rejectCurrentMediaRequest",
                        params: { error: new Error("Sign in again to continue playback.") },
                      },
                      "dequeueMediaRequest",
                    ],
                  },
                  {
                    guard: "isMediaCookieDiscarded",
                    target: "#accountSession.mediaAuthorization.idle",
                    actions: ["resolveCurrentMediaRequest", "dequeueMediaRequest"],
                  },
                  { target: "installingNativeSession" },
                ],
                onError: {
                  target: "#accountSession.mediaAuthorization.idle",
                  actions: [
                    {
                      type: "rejectCurrentMediaRequest",
                      params: ({ event }) => ({ error: event.error }),
                    },
                    "dequeueMediaRequest",
                  ],
                },
              },
              states: {
                current: {
                  on: {
                    // The request cannot be recalled; wait for its response but ignore its result.
                    SESSION_SCOPE_ENDED: {
                      target: "discarded",
                      actions: ["resolveWaitingMediaRequests", "keepOnlyCurrentMediaRequest"],
                    },
                  },
                },
                discarded: {},
              },
            },
            installingNativeSession: {
              invoke: {
                src: "installNativeMediaSession",
                input: ({ context }) => ({ session: requireMediaSession(context) }),
                onDone: {
                  target: "#accountSession.mediaAuthorization.idle",
                  actions: ["resolveCurrentMediaRequest", "dequeueMediaRequest"],
                },
                onError: {
                  target: "#accountSession.mediaAuthorization.idle",
                  actions: [
                    {
                      type: "rejectCurrentMediaRequest",
                      params: ({ event }) => ({ error: event.error }),
                    },
                    "dequeueMediaRequest",
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
});

/** Derives the state the UI shows; the facade keeps the result referentially stable. */
export function selectAuthState(snapshot: AccountSessionSnapshot): AccountAuthState {
  if (snapshot.matches({ session: "error" })) {
    return {
      status: "error",
      error: snapshot.context.initializationError ?? SIGN_IN_UNAVAILABLE,
    };
  }
  // A sign-out requested during initialization shows signed-out before initialization finishes.
  if (snapshot.context.signOutReplies.length > 0) {
    return { status: "signed-out" };
  }
  if (!snapshot.hasTag("initialized")) {
    return { status: "loading" };
  }
  const { session } = snapshot.context;
  return session ? { status: "signed-in", session } : { status: "signed-out" };
}

type AccountSessionContext = {
  connection: AccountAuthConnection | undefined;
  session: Session | null;
  initializationError: Error | undefined;
  signIn: { request: SignInRequest; reply: Reply<void> } | undefined;
  signOutReplies: Reply<void>[];
  isRevocationConfirmed: boolean;
  /** The first request is the one being issued while `mediaAuthorization` is `issuing`. */
  mediaRequests: Reply<void>[];
  mediaSession: Session | undefined;
};

type ReadSessionEvent = { type: "READ_SESSION"; reply: Reply<Session | null> };

type AccountSessionEvent =
  | { type: "INITIALIZE" }
  | { type: "SESSION_CHANGED"; session: Session | null }
  | ReadSessionEvent
  | { type: "SIGN_IN"; request: SignInRequest; reply: Reply<void> }
  | { type: "SIGN_OUT"; reply: Reply<void> }
  | { type: "AUTHORIZE_MEDIA"; reply: Reply<void> }
  | { type: "APP_RESUMED" }
  | { type: "RESUMED_MEDIA_AUTHORIZATION_FAILED" }
  | { type: "SESSION_SCOPE_ENDED" };

/** Typed as the whole union; a constant would narrow to the one event it holds. */
function eventTypeWitness(): AccountSessionEvent {
  return { type: "INITIALIZE" };
}

async function readSession(client: AccountAuthClient) {
  const result = await client.auth.getSession();
  if (result.error) {
    throw result.error;
  }
  return result.data.session;
}

async function settleRead(
  client: AccountAuthClient,
  reply: Reply<Session | null>,
  pendingReplies: Set<Reply<Session | null>>,
) {
  try {
    const session = await readSession(client);
    if (pendingReplies.delete(reply)) {
      reply.resolve(session);
    }
  } catch (error) {
    if (pendingReplies.delete(reply)) {
      reply.reject(error);
    }
  }
}

function requireConnection(context: AccountSessionContext) {
  if (!context.connection) {
    throw new Error(NOT_INITIALIZED_MESSAGE);
  }
  return context.connection;
}

function requireSignIn(context: AccountSessionContext) {
  if (!context.signIn) {
    throw new Error("No sign-in is in progress.");
  }
  return context.signIn;
}

function requireMediaSession(context: AccountSessionContext) {
  if (!context.mediaSession) {
    throw new Error("No session is being authorized for media.");
  }
  return context.mediaSession;
}

function resolveAll(replies: readonly Reply<void>[]) {
  for (const reply of replies) {
    reply.resolve();
  }
}

function rejectAll(replies: readonly Reply<void>[], error: unknown) {
  for (const reply of replies) {
    reply.reject(error);
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : SIGN_IN_UNAVAILABLE;
}

function missingImplementation(name: string) {
  return new Error(`Provide "${name}" through accountSessionMachine.provide(...).`);
}
