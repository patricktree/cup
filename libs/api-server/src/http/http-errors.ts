import type { GrantState } from "@cup/conversion-grants";
import { assertUnreachable } from "@cup/errors";
import type { ErrorCode as ListenerErrorCode } from "@cup/listener-api.routes";
import type { ErrorCode as OperatorErrorCode } from "@cup/operator-api.routes";

/** Every code an API error response can carry; each API's contract lists the codes it returns. */
type ErrorCode = ListenerErrorCode | OperatorErrorCode;

export function accountAuthError(
  result: "unauthorized" | "unavailable" | "blocked" | "rate-limited",
  requestId: string,
  retryAfter = 3600,
) {
  if (result === "rate-limited") {
    return jsonError(
      requestId,
      "rate-limited",
      "Too many new accounts from this connection. Please try later.",
      429,
      { "Retry-After": String(retryAfter) },
    );
  }
  if (result === "unauthorized") {
    return jsonError(requestId, "account-session-required", "Sign in to continue.", 401);
  }
  if (result === "blocked") {
    return jsonError(requestId, "account-blocked", "Account access is blocked.", 403);
  }
  if (result === "unavailable") {
    return jsonError(
      requestId,
      "account-setup-pending",
      "Account setup is temporarily unavailable. Please retry.",
      503,
    );
  }
  return assertUnreachable(result);
}

export function requireAccessibleGrantState(
  state: GrantState,
  requestId: string,
): Response | undefined {
  if (state === "expired" || state === "revoked") {
    return jsonError(
      requestId,
      `grant-${state}`,
      state === "expired"
        ? "This trial has expired. Its audiobooks are no longer accessible."
        : "This trial has been revoked. Its audiobooks are no longer accessible.",
      403,
    );
  }
  return undefined;
}

/** The error envelope both API contracts declare, with a code from either contract. */
function createErrorBody(requestId: string, code: ErrorCode, message: string) {
  return { error: { code, message, requestId } };
}

export function jsonError(
  requestId: string,
  code: ErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 416 | 429 | 500 | 503,
  headers?: HeadersInit,
): Response {
  return Response.json(createErrorBody(requestId, code, message), {
    status,
    ...(headers === undefined ? {} : { headers }),
  });
}
