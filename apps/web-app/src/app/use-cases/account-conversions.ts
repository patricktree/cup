import { useMutation } from "@tanstack/react-query";
import React from "react";

import { signInGoogle } from "#src/auth/account-session.js";
import { useAccountSession, useAccountAuthState } from "#src/auth/hooks.js";
import {
  readPendingAccountConversion,
  storePendingAccountConversion,
} from "#src/data-fetching/account-conversion-storage.js";
import { useStartAccountConversionMutation } from "#src/data-fetching/account.js";
import { useRateLimitCountdown } from "#src/data-fetching/rate-limit.js";

export function useAccountConversionSubmission({
  onStarted,
}: {
  onStarted: (conversionId: string) => Promise<void>;
}) {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  const signIn = useMutation({ mutationFn: () => signInGoogle() });
  const start = useStartAccountConversionMutation(onStarted);
  const retryIn = useRateLimitCountdown(start.error);

  const [requiresSignIn, setRequiresSignIn] = React.useState(false);
  const resumed = React.useRef(false);

  React.useEffect(() => {
    const request = readPendingAccountConversion();
    if (session && request?.submitted && !resumed.current) {
      resumed.current = true;
      start.mutate({ ...request, subject: session.user.id });
    }
  }, [session, start]);

  return {
    initialSourceUrl: readPendingAccountConversion()?.sourceUrl ?? "",
    isPending: start.isPending || authState.status === "loading",
    retryIn,
    error: start.error?.message,
    requiresSignIn: requiresSignIn && !session,
    signIn,
    submit: async ({ sourceUrl: input }: { sourceUrl: string }) => {
      if (start.isPending || retryIn > 0 || authState.status === "loading") return;
      signIn.reset();
      const sourceUrl = new URL(input).toString();
      const stored = readPendingAccountConversion();
      const request = {
        sourceUrl,
        idempotencyKey:
          stored?.sourceUrl === sourceUrl ? stored.idempotencyKey : crypto.randomUUID(),
        submitted: true,
      };
      storePendingAccountConversion(request);
      if (!session) {
        resumed.current = false;
        setRequiresSignIn(true);
        return;
      }
      resumed.current = true;
      await start.mutateAsync({ ...request, subject: session.user.id }).catch(() => {});
    },
    cancelSignIn: () => {
      if (signIn.isPending) return;
      const request = readPendingAccountConversion();
      if (request) storePendingAccountConversion({ ...request, submitted: false });
      setRequiresSignIn(false);
    },
  };
}
