import React from "react";

import type { SignInMethod } from "#src/auth/account-session.js";
import { useAccountSession, useAccountAuthState, useSignInMethods } from "#src/auth/hooks.js";
import {
  clearPendingAccountConversion,
  readPendingAccountConversion,
  storePendingAccountConversion,
  type PendingAccountConversion,
} from "#src/data-fetching/account-conversion-storage.js";
import {
  useSignInMutation,
  useStartAccountConversionMutation,
} from "#src/data-fetching/account.js";
import { useRateLimitCountdown } from "#src/data-fetching/rate-limit.js";

/** What opened the sign-in: the home page's sign-in link, or a submission while signed out. */
export type SignInEntry = "home-link" | "submission";

type PendingRequestStore = {
  read: () => PendingAccountConversion | null;
  store: (request: PendingAccountConversion) => void;
  clear: () => void;
};

const SESSION_REQUEST_STORE: PendingRequestStore = {
  read: readPendingAccountConversion,
  store: storePendingAccountConversion,
  clear: clearPendingAccountConversion,
};

/**
 * Submits a source URL as an account conversion, asking for sign-in first when needed.
 *
 * With `requestStorage: "session"` the pending request lives in `sessionStorage`, so the home
 * page's start survives the OAuth redirect and resumes on its next mount. With `"memory"` it lives
 * only as long as the mounted form, such as the Add dialog, whose starts never resume elsewhere.
 */
export function useAccountConversionSubmission({
  requestStorage,
  onStarted,
  onSignedInFromLink,
}: {
  requestStorage: "session" | "memory";
  onStarted: (conversionId: string) => Promise<void>;
  /** Called once a sign-in from the home page's sign-in link completes on this page. */
  onSignedInFromLink?: () => Promise<void>;
}) {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  const signIn = useSignInMutation();
  const signInMethods = useSignInMethods();
  const start = useStartAccountConversionMutation(onStarted);
  const retryIn = useRateLimitCountdown(start.error);

  const [isSignInOpen, setIsSignInOpen] = React.useState(false);
  // Kept after the sign-in closes, so its copy and the focus it returns to stay with that entry.
  const [signInEntry, setSignInEntry] = React.useState<SignInEntry>("submission");
  const resumed = React.useRef(false);
  const isSigningInFromLink = React.useRef(false);
  const requests = React.useMemo(
    () => (requestStorage === "session" ? SESSION_REQUEST_STORE : createMemoryRequestStore()),
    [requestStorage],
  );

  React.useEffect(() => {
    const request = requests.read();
    if (session && request?.submitted && !resumed.current) {
      resumed.current = true;
      start.mutate({ ...request, subject: session.user.id });
    }
  }, [requests, session, start]);

  /*
   * An in-place sign-in (the test account, Android's native sign-in, iOS's browser sheet) completes
   * on this page, so the page leaves for where it sends a signed-in listener itself. A web Google
   * sign-in returns through the OAuth redirect instead, and a submitted request resumes here.
   */
  React.useEffect(() => {
    if (!session || !isSigningInFromLink.current || requests.read()?.submitted) {
      return;
    }
    isSigningInFromLink.current = false;
    void onSignedInFromLink?.();
  }, [onSignedInFromLink, requests, session]);

  return {
    initialSourceUrl: requests.read()?.sourceUrl ?? "",
    isPending: start.isPending || authState.status === "loading",
    isAuthLoading: authState.status === "loading",
    retryIn,
    error: start.error,
    /** Sign-in explains itself in place of a failed start while it is open. */
    isSignInOpen: isSignInOpen && !session,
    /** The entry that opened the sign-in last, also after it closed. */
    signInEntry,
    /** Signed out once auth has settled, so the listener can choose to sign in. */
    canSignIn: !session && authState.status !== "loading",
    signIn,
    /**
     * Signs in with `method`. From the sign-in link, it first drops a stored request that was never
     * submitted, so the sign-in lands where home sends a signed-in listener.
     */
    startSignIn: (method: SignInMethod) => {
      if (signInEntry === "home-link") {
        if (requests.read()?.submitted === false) {
          requests.clear();
        }

        isSigningInFromLink.current = true;
      }

      signIn.mutate(method);
    },
    signInMethods,
    submit: async ({ sourceUrl: input }: { sourceUrl: string }) => {
      if (start.isPending || retryIn > 0 || authState.status === "loading") {
        return;
      }
      signIn.reset();
      const sourceUrl = new URL(input).toString();
      const stored = requests.read();
      const request = {
        sourceUrl,
        idempotencyKey:
          stored?.sourceUrl === sourceUrl ? stored.idempotencyKey : crypto.randomUUID(),
        submitted: true,
      };
      requests.store(request);
      if (!session) {
        resumed.current = false;
        setSignInEntry("submission");
        setIsSignInOpen(true);
        return;
      }
      resumed.current = true;
      await start.mutateAsync({ ...request, subject: session.user.id }).catch(() => {});
    },
    /** Opens the sign-in without a submission, so it starts without a previous sign-in error. */
    openSignIn: () => {
      signIn.reset();
      setSignInEntry("home-link");
      setIsSignInOpen(true);
    },
    /** Closes the sign-in; only a submission's sign-in marks its stored request unsubmitted. */
    cancelSignIn: () => {
      if (signIn.isPending) {
        return;
      }
      const request = requests.read();
      if (signInEntry === "submission" && request) {
        requests.store({ ...request, submitted: false });
      }
      setIsSignInOpen(false);
    },
  };
}

function createMemoryRequestStore(): PendingRequestStore {
  let current: PendingAccountConversion | null = null;
  return {
    read: () => current,
    store: (request) => {
      current = request;
    },
    clear: () => {
      current = null;
    },
  };
}
