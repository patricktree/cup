import {
  createOkResponseParser,
  RpcError as ApiRpcError,
  type ErrorCodeConstants,
} from "@cup/api-rpc.client";
import type { ErrorCode } from "@cup/listener-api.routes";

export type { ErrorCode } from "@cup/listener-api.routes";

/**
 * Every value of {@link RpcError.code}, the contract's `ERROR_CODE` as the client's own value: only
 * the contract's types are imported, so the client does not bundle the contract's runtime, and
 * `satisfies` fails to compile when a code is missing here or not in the contract.
 */
export const ERROR_CODE = {
  ACCOUNT_BLOCKED: "account-blocked",
  ACCOUNT_SESSION_REQUIRED: "account-session-required",
  ACCOUNT_SETUP_PENDING: "account-setup-pending",
  ACCOUNT_START_CONFLICT: "account-start-conflict",
  AUDIOBOOK_NOT_FOUND: "audiobook-not-found",
  CONFIRMATION_UNAVAILABLE: "confirmation-unavailable",
  CONVERSION_NOT_FOUND: "conversion-not-found",
  COVER_IMAGE_NOT_FOUND: "cover-image-not-found",
  CREDITS_UNAVAILABLE: "credits-unavailable",
  DEPENDENCY_UNAVAILABLE: "dependency-unavailable",
  FRESH_AUTH_REQUIRED: "fresh-auth-required",
  GRANT_EXHAUSTED: "grant-exhausted",
  GRANT_EXPIRED: "grant-expired",
  GRANT_REVOKED: "grant-revoked",
  GRANT_SESSION_INVALID: "grant-session-invalid",
  GRANT_SESSION_REQUIRED: "grant-session-required",
  GRANT_TEMPORARILY_FULL: "grant-temporarily-full",
  IDEMPOTENCY_CONFLICT: "idempotency-conflict",
  INGRESS_UNAVAILABLE: "ingress-unavailable",
  INVALID_CREDENTIAL: "invalid-credential",
  INVALID_INPUT: "invalid-input",
  MEDIA_URL_INVALID: "media-url-invalid",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  NOT_FOUND: "not-found",
  OPERATIONAL_ERROR: "operational-error",
  ORIGIN_BLOCKED: "origin-blocked",
  ORIGIN_FORBIDDEN: "origin-forbidden",
  RANGE_NOT_SATISFIABLE: "range-not-satisfiable",
  RATE_LIMITED: "rate-limited",
  REQUEST_TOO_LARGE: "request-too-large",
  START_RATE_LIMITED: "start-rate-limited",
  UNSUPPORTED_MEDIA_TYPE: "unsupported-media-type",
} as const satisfies ErrorCodeConstants<ErrorCode>;

/**
 * An unsuccessful listener API response, carrying the API error code, HTTP status, retry delay, and
 * the server's request ID.
 */
export class RpcError extends ApiRpcError<ErrorCode> {}

/**
 * Preserves Hono's inferred successful payload and throws {@link RpcError} for every unsuccessful
 * response; a response without a known error code gets `operational-error`.
 */
export const parseOkResponse = createOkResponseParser({
  errorCodes: ERROR_CODE,
  fallbackCode: ERROR_CODE.OPERATIONAL_ERROR,
  createError: (details) => new RpcError(details),
});
