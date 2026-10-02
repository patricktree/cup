import { useMutation } from "@tanstack/react-query";
import React from "react";

import { parseOkResponse, RpcError } from "@cup/web-app-api.client";
import { accountStartResponseSchema } from "@cup/web-app-api.routes";

import {
  readPendingAccountConversion,
  storePendingAccountConversion,
  clearPendingAccountConversion,
  type PendingAccountConversion,
} from "#src/data-fetching/account-conversion-storage.js";
import { invalidateAccountHistory } from "#src/data-fetching/account-history.js";
import {
  getAuthenticatedRpcClient,
  sessionSnapshot,
  signInGoogle,
} from "#src/data-fetching/account-session.js";
import {
  invalidateAccountQueries,
  useAccountSession,
  useAccountAuthState,
} from "#src/data-fetching/account.js";
import { useRateLimitCountdown } from "#src/data-fetching/rate-limit.js";

export function useAccountConversionSubmission(onStarted: (conversionId: string) => Promise<void>) {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  const [requiresSignIn, setRequiresSignIn] = React.useState(false);
  const resumed = React.useRef(false);
  const signIn = useMutation({ mutationFn: () => signInGoogle() });
  const start = useStartAccountConversionMutation(onStarted);
  const retryIn = useRateLimitCountdown(start.error);
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

function useStartAccountConversionMutation(onSuccess: (conversionId: string) => Promise<void>) {
  return useMutation({
    onError: (failure, request) => {
      if (sessionSnapshot()?.user.id !== request.subject) return;
      if (failure instanceof RpcError && failure.status === 429) {
        const pending = readPendingAccountConversion();
        if (pending?.idempotencyKey === request.idempotencyKey)
          storePendingAccountConversion({ ...pending, submitted: false });
      }
    },
    mutationFn: async (request: PendingAccountConversion & { subject: string }) => {
      const response = await (
        await getAuthenticatedRpcClient(request.subject)
      ).startAccountConversion({ sourceUrl: request.sourceUrl }, request.idempotencyKey);
      return accountStartResponseSchema.parse(await parseOkResponse(response));
    },
    onSuccess: async (result, request) => {
      if (sessionSnapshot()?.user.id !== request.subject) return;
      if (readPendingAccountConversion()?.idempotencyKey === request.idempotencyKey)
        clearPendingAccountConversion();
      await Promise.all([
        invalidateAccountQueries(request.subject),
        invalidateAccountHistory(request.subject),
      ]);
      if (sessionSnapshot()?.user.id === request.subject) await onSuccess(result.conversionId);
    },
  });
}
