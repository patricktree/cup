import { queryOptions } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";

import { RpcError } from "@cup/web-app-api.client";
import { parseOkResponse } from "@cup/web-app-api.client";
import { accountStartResponseSchema } from "@cup/web-app-api.routes";

import { sessionSnapshot } from "#src/auth/account-session.js";
import { getAuthenticatedRpcClient } from "#src/auth/account-session.js";
import {
  readPendingAccountConversion,
  storePendingAccountConversion,
  clearPendingAccountConversion,
  type PendingAccountConversion,
} from "#src/data-fetching/account-conversion-storage.js";
import { invalidateAccountHistory } from "#src/data-fetching/account-history.js";
import { queryClient } from "#src/data-fetching/query-client.js";

export const accountQuery = (subject?: string) =>
  queryOptions({
    queryKey: ["account", subject],
    enabled: !!subject,
    queryFn: async () => parseOkResponse((await getAuthenticatedRpcClient(subject)).getAccount()),
    retry: false,
  });

export function invalidateAccountQueries(subject?: string) {
  return queryClient.invalidateQueries({
    queryKey: subject === undefined ? ["account"] : accountQuery(subject).queryKey,
  });
}

export function useStartAccountConversionMutation(
  onSuccess: (conversionId: string) => Promise<void>,
) {
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
