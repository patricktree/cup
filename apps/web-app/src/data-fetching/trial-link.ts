import { queryOptions, useMutation } from "@tanstack/react-query";
import React from "react";

import {
  audiobookSchema,
  errorResponseSchema,
  grantSnapshotSchema,
  startConversionResponseSchema,
  type Audiobook,
  type GrantSnapshot,
  type StartConversionResponse,
} from "@cup/web-app-api.routes";

import { createAppApiClient } from "#src/api-client.js";
import { getResourceAccountSession } from "#src/data-fetching/account-session.js";

const POLL_INTERVAL_MS = 2_000;
const rpcClient = createAppApiClient();

export const createGrantQueryKey = (grantId: string) => ["conversion-grant", grantId] as const;

export function createGrantQuery(grantId: string) {
  return queryOptions({
    queryKey: createGrantQueryKey(grantId),
    queryFn: ({ signal }) => getGrant(grantId, signal),
  });
}

export function useStartTrialConversionMutation(
  grantId: string,
  onStarted: (conversionId: string) => Promise<void>,
) {
  const pending = React.useRef<{
    grantId: string;
    sourceUrl: string;
    idempotencyKey: string;
  } | null>(null);
  return useMutation({
    mutationFn: async (sourceUrl: string) => {
      if (pending.current?.grantId !== grantId || pending.current.sourceUrl !== sourceUrl)
        pending.current = { grantId, sourceUrl, idempotencyKey: crypto.randomUUID() };
      return startTrialConversion(grantId, sourceUrl, pending.current.idempotencyKey);
    },
    onSuccess: (result) => onStarted(result.conversion.conversionId),
  });
}

export function createAudiobookQuery(conversionId: string) {
  return queryOptions({
    queryKey: ["audiobook", conversionId],
    queryFn: ({ signal }) => getAudiobook(conversionId, signal),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? POLL_INTERVAL_MS : false),
    refetchIntervalInBackground: true,
  });
}

export async function exchangeCredential(
  grantId: string,
  credential: string,
): Promise<GrantSnapshot> {
  const response = await rpcClient.exchangeCredential({ grantId }, { credential });
  return parseResponse(response, (body) => grantSnapshotSchema.parse(body));
}

async function startTrialConversion(
  grantId: string,
  sourceUrl: string,
  idempotencyKey: string,
): Promise<StartConversionResponse> {
  const response = await rpcClient.startTrialConversion({ grantId }, { sourceUrl }, idempotencyKey);
  return parseResponse(response, (body) => startConversionResponseSchema.parse(body));
}

async function getGrant(grantId: string, signal: AbortSignal): Promise<GrantSnapshot> {
  const response = await rpcClient.getGrant({ grantId }, signal);
  return parseResponse(response, (body) => grantSnapshotSchema.parse(body));
}

async function getAudiobook(conversionId: string, signal: AbortSignal): Promise<Audiobook> {
  const session = await getResourceAccountSession();
  const response = session
    ? await rpcClient
        .createAuthenticatedRpcClient(session.access_token)
        .getAudiobook({ conversionId }, signal)
    : await rpcClient.getAudiobook({ conversionId }, signal);
  return parseResponse(response, (body) => audiobookSchema.parse(body));
}

export async function parseResponse<Result>(
  response: Response,
  parseResult: (value: unknown) => Result,
): Promise<Result> {
  const body: unknown = await response.json();
  if (response.ok) return parseResult(body);
  const error = errorResponseSchema.safeParse(body);
  throw new ApiError(
    error.success ? error.data.error.code : "operational-error",
    error.success ? error.data.error.message : "The request could not be completed.",
    response.status,
    response.headers.get("Retry-After"),
  );
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(code: string, message: string, status: number, retryAfter: string | null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
