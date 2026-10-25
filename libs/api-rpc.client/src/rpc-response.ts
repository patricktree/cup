import { parseResponse, DetailedError as HonoDetailedError } from "hono/client";
import type { ClientResponse } from "hono/client";
import type { IsAny, ScreamingSnakeCase } from "type-fest";

/**
 * The shape of a client's `ERROR_CODE` constant: one `SCREAMING_SNAKE_CASE` key per error code of
 * the API. A client declares its constant with `satisfies ErrorCodeConstants<ErrorCode>`, so it
 * fails to compile when a code is missing or is not in the contract.
 */
export type ErrorCodeConstants<Code extends string> = {
  readonly [Value in Code as ScreamingSnakeCase<Value>]: Value;
};

/** What an unsuccessful API response tells the client. */
export type RpcErrorDetails<Code extends string> = {
  /** API error code, or the fallback code when the response carried no known code. */
  code: Code;
  message: string;
  status: number;
  /** Seconds to wait before retrying: the `Retry-After` header, or 60 when it is absent. */
  retryAfter: number;
  /** The server's request ID from the error envelope, absent when the response carried none. */
  requestId: string | undefined;
};

/**
 * An unsuccessful API response. Each client package extends it with its API's error codes, so
 * `instanceof` narrows to the client's code type.
 */
export class RpcError<Code extends string = string> extends Error {
  readonly code: Code;
  readonly status: number;
  readonly retryAfter: number;
  readonly requestId: string | undefined;

  constructor({ code, message, status, retryAfter, requestId }: RpcErrorDetails<Code>) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
  }
}

/**
 * Creates a function that preserves Hono's inferred successful payload and throws the client's
 * {@link RpcError} for every unsuccessful response. A response without an error code of the API,
 * such as a proxy's HTML error page or a code this client does not know yet, gets `fallbackCode`.
 */
export function createOkResponseParser<Code extends string>({
  errorCodes,
  fallbackCode,
  createError,
}: {
  /** The client's `ERROR_CODE`; it checks its own completeness with {@link ErrorCodeConstants}. */
  errorCodes: Readonly<Record<string, Code>>;
  fallbackCode: NoInfer<Code>;
  createError: (details: RpcErrorDetails<Code>) => RpcError<Code>;
}) {
  const knownCodes: ReadonlySet<string> = new Set<string>(Object.values(errorCodes));
  const isKnownCode = (code: string): code is Code => knownCodes.has(code);

  return async function parseOkResponse<ResponseType extends ClientResponse<unknown>>(
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
      throw createError({
        code: body.code !== undefined && isKnownCode(body.code) ? body.code : fallbackCode,
        message: body.message ?? "The request could not be completed.",
        status: response.status,
        retryAfter: Math.max(1, Number(response.headers.get("Retry-After")) || 60),
        requestId: body.requestId,
      });
    }
  };
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

/**
 * Reads the code, message, and request ID of an API error response body; other bodies yield none of
 * them.
 */
function readErrorBody(error: ParseResponseError): {
  code?: string;
  message?: string;
  requestId?: string;
} {
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
    ...("requestId" in body && typeof body.requestId === "string"
      ? { requestId: body.requestId }
      : {}),
  };
}
