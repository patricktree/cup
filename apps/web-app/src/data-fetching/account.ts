import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { queryOptions } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";

import { accountStartResponseSchema } from "@cup/listener-api.routes";

import { isSignedInAs, signIn, type SignInMethod } from "#src/auth/account-session.js";
import {
  readPendingAccountConversion,
  storePendingAccountConversion,
  clearPendingAccountConversion,
  type PendingAccountConversion,
} from "#src/data-fetching/account-conversion-storage.js";
import { requestApi, RpcError } from "#src/data-fetching/api-request.js";
import { queryClient } from "#src/data-fetching/query-client.js";
import { QUERY_KEYS } from "#src/data-fetching/query-keys.js";

export const accountQuery = (subject?: string) =>
  queryOptions({
    queryKey: QUERY_KEYS.accountSnapshot(subject),
    enabled: !!subject,
    queryFn: async () => {
      check.assert(subject, "The account query runs only for a signed-in account.");
      return requestApi({ subject }, (client) => client.getAccount());
    },
    retry: false,
    // The account settings replace themselves with the setup error, which explains rate limiting.
    meta: { errorDisplay: "inline" },
  });

/** Invalidates every query of the account's data: its snapshot and its history. */
export function invalidateAccountQueries(subject: string) {
  return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.account(subject) });
}

export function invalidateAccountSnapshot(subject: string) {
  return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.accountSnapshot(subject) });
}

export function useSignInMutation() {
  return useMutation({
    // The sign-in dialog keeps its failure next to the button that tries again.
    meta: { errorDisplay: "inline" },
    mutationFn: (method: SignInMethod) => signIn(method),
  });
}

export function useStartAccountConversionMutation(
  onSuccess: (conversionId: string) => Promise<void>,
) {
  return useMutation({
    // The start form shows refusals and the rate-limit countdown next to the submitted URL.
    meta: { errorDisplay: "inline" },
    onError: (failure, request) => {
      if (!isSignedInAs(request.subject)) {
        return;
      }
      if (failure instanceof RpcError && failure.status === 429) {
        const pending = readPendingAccountConversion();
        if (pending?.idempotencyKey === request.idempotencyKey) {
          storePendingAccountConversion({ ...pending, submitted: false });
        }
      }
    },
    mutationFn: async (request: PendingAccountConversion & { subject: string }) =>
      accountStartResponseSchema.parse(
        await requestApi({ subject: request.subject }, (client) =>
          client.startAccountConversion({ sourceUrl: request.sourceUrl }, request.idempotencyKey),
        ),
      ),
    onSuccess: async (result, request) => {
      if (!isSignedInAs(request.subject)) {
        return;
      }
      if (readPendingAccountConversion()?.idempotencyKey === request.idempotencyKey) {
        clearPendingAccountConversion();
      }
      await invalidateAccountQueries(request.subject);
      if (isSignedInAs(request.subject)) {
        await onSuccess(result.conversionId);
      }
    },
  });
}
