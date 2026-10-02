import type { ErrorResponse } from "@cup/web-app-api.routes";

export function accountAuthError(
  result: "unauthorized" | "unavailable" | "blocked" | "rate-limited",
  requestId: string,
  retryAfter = 3600,
) {
  if (result === "rate-limited")
    return jsonError(
      requestId,
      "rate-limited",
      "Too many new accounts from this connection. Please try later.",
      429,
      { "Retry-After": String(retryAfter) },
    );
  if (result === "unauthorized")
    return jsonError(requestId, "account-session-required", "Sign in to continue.", 401);
  if (result === "blocked")
    return jsonError(requestId, "account-blocked", "Account access is blocked.", 403);
  return jsonError(
    requestId,
    "account-setup-pending",
    "Account setup is temporarily unavailable. Please retry.",
    503,
  );
}

function createErrorBody(requestId: string, code: string, message: string): ErrorResponse {
  return { error: { code, message, requestId } };
}

export function jsonError(
  requestId: string,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 429 | 500 | 503,
  headers?: HeadersInit,
): Response {
  return Response.json(createErrorBody(requestId, code, message), {
    status,
    ...(headers === undefined ? {} : { headers }),
  });
}
