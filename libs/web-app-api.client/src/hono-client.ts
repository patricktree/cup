import { hc, parseResponse, DetailedError as HonoDetailedError } from "hono/client";
import type { ClientResponse } from "hono/client";
import type { IsAny } from "type-fest";

import type { WebAppApiApp, WebAppApiClient } from "@cup/web-app-api.routes";

/**
 * Preserve Hono's inferred successful payload and throw {@link RpcError} for every unsuccessful
 * response.
 */
export async function parseOkResponse<ResponseType extends ClientResponse<unknown>>(
  request: ResponseType | Promise<ResponseType>,
): ReturnType<typeof parseResponse<ResponseType>> {
  const response = await request;
  try {
    return await parseResponse(response);
  } catch (error) {
    if (!isParseResponseError(error)) {
      throw error;
    }
    const body = readErrorBody(error);
    throw new RpcError(
      body.code ?? "operational-error",
      body.message ?? "The request could not be completed.",
      response.status,
      Math.max(1, Number(response.headers.get("Retry-After")) || 60),
    );
  }
}

/** An unsuccessful API response, carrying the API error code and HTTP status. */
export class RpcError extends Error {
  /** API error code, or `operational-error` when the response carried none. */
  readonly code: string;
  readonly status: number;
  /** Seconds to wait before retrying: the `Retry-After` header, or 60 when it is absent. */
  readonly retryAfter: number;
  constructor(code: string, message: string, status: number, retryAfter: number) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// This indirection preserves inferred routes and works around TypeScript issue 47663.
const hcWithType = (...args: Parameters<typeof hc>): WebAppApiClient => hc<WebAppApiApp>(...args);

/** Typed Hono client inferred from the create-audiobook-from-url API routes. */
export type HonoClient = ReturnType<typeof hcWithType>;

/** Creates a typed Hono client for the supplied API base URL. */
export function createHonoClient(baseUrl: string): HonoClient {
  return hcWithType(trimTrailingSlash(baseUrl), {});
}

type MapAnyToUnknown<T> = {
  [Key in keyof T]: IsAny<T[Key]> extends true ? unknown : T[Key];
};

type ParseResponseError = MapAnyToUnknown<HonoDetailedError>;

/** Narrows an unknown error to Hono's detailed response parsing error shape. */
function isParseResponseError(error: unknown): error is ParseResponseError {
  return (
    error instanceof HonoDetailedError ||
    (typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      "message" in error &&
      typeof error.message === "string")
  );
}

/** Reads the code and message of an API error response body; other bodies yield neither. */
function readErrorBody(error: ParseResponseError): { code?: string; message?: string } {
  const detailData =
    typeof error.detail === "object" && error.detail !== null && "data" in error.detail
      ? error.detail.data
      : undefined;
  const body =
    detailData !== null &&
    typeof detailData === "object" &&
    "error" in detailData &&
    typeof detailData.error === "object" &&
    detailData.error !== null
      ? detailData.error
      : {};
  return {
    ...("code" in body && typeof body.code === "string" ? { code: body.code } : {}),
    ...("message" in body && typeof body.message === "string" ? { message: body.message } : {}),
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}
