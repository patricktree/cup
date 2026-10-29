import {
  createOkResponseParser,
  RpcError as ApiRpcError,
  type ErrorCodeConstants,
} from "@cup/api-rpc.client";
import type { ErrorCode } from "@cup/operator-api.routes";

export type { ErrorCode } from "@cup/operator-api.routes";

/**
 * Every value of {@link RpcError.code}, the contract's `ERROR_CODE` as the client's own value: only
 * the contract's types are imported, so the client does not bundle the contract's runtime, and
 * `satisfies` fails to compile when a code is missing here or not in the contract.
 */
export const ERROR_CODE = {
  ACCOUNT_NOT_ACTIVE: "account-not-active",
  ACCOUNT_NOT_FOUND: "account-not-found",
  ACCOUNT_UNAVAILABLE: "account-unavailable",
  ADJUSTMENT_EXCEEDS_AVAILABLE_DURATION: "adjustment-exceeds-available-duration",
  ALLOWANCE_BELOW_USED_DURATION: "allowance-below-used-duration",
  CONVERSION_NOT_ACCOUNT_OWNED: "conversion-not-account-owned",
  CONVERSION_NOT_FOUND: "conversion-not-found",
  GRANT_NOT_FOUND: "grant-not-found",
  IDEMPOTENCY_CONFLICT: "idempotency-conflict",
  INVALID_CURSOR: "invalid-cursor",
  INVALID_INPUT: "invalid-input",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  NOT_FOUND: "not-found",
  OPERATIONAL_ERROR: "operational-error",
  OPERATOR_UNAUTHORIZED: "operator-unauthorized",
  REQUEST_TOO_LARGE: "request-too-large",
  UNSUPPORTED_MEDIA_TYPE: "unsupported-media-type",
} as const satisfies ErrorCodeConstants<ErrorCode>;

/**
 * An unsuccessful operator API response, carrying the API error code, HTTP status, retry delay, and
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
