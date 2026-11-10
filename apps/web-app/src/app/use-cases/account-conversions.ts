import React from "react";

import { useAccountSession, useAccountAuthState, useSignInMethods } from "#src/auth/hooks.js";
import {
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
type SignInEntry = "home-link" | "submission";

type PendingRequestStore = {
  read: () => PendingAccountConversion | null;
  store: (request: PendingAccountConversion) => void;
};

const SESSION_REQUEST_STORE: PendingRequestStore = {
  read: readPendingAccountConversion,
  store: storePendingAccountConversion,
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
}: {
  requestStorage: "session" | "memory";
  onStarted: (conversionId: string) => Promise<void>;
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

  return {
    initialSourceUrl: requests.read()?.sourceUrl ?? "",
    isPending: start.isPending || authState.status === "loading",
    isAuthLoading: authState.status === "loading",
    retryIn,
    error: start.error,
    isSignInOpen: isSignInOpen && !session,
    /** The entry that opened the sign-in last. */
    signInEntry,
    requiresSignIn: isSignInOpen && signInEntry === "submission" && !session,
    /** Signed out once auth has settled, so the listener can choose to sign in. */
    canSignIn: !session && authState.status !== "loading",
    signIn,
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
  };
}
