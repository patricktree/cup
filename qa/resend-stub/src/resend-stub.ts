/*
 * A `node:http` stand-in for Resend's `POST /emails`, one instance per test on an OS-assigned port.
 * By default it models Resend's documented request checks and idempotency with a ledger keyed by
 * `Idempotency-Key`; a test can script, hang or hold the next requests' answers instead. The live
 * contract test (`pnpm test:resend-live`) checks the model against the real API.
 *
 * The modeled behavior follows Resend's docs as read on 2026-10-20:
 * - API introduction (https://resend.com/docs/api-reference/introduction): requests without a
 *   `User-Agent` header are refused with 403.
 * - Idempotency keys (https://resend.com/docs/dashboard/emails/idempotency-keys): keys are 1 to 256
 *   characters and kept for 24 hours; a replay with the same body returns the original response
 *   without sending again, a replay with a modified body answers `409 invalid_idempotent_request`,
 *   and a replay while the first request is in progress answers `409 concurrent_idempotent_requests`.
 * - Errors (https://resend.com/docs/api-reference/errors): the `{ statusCode, name, message }` shape.
 *
 * Where the docs are silent the stub picks one reading and says so: the 24 hours count from the
 * first request, an expired key sends again, "modified" compares parsed JSON, and a refused request
 * leaves no trace on its key.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import util from "node:util";
import { Temporal } from "temporal-polyfill";

/** How long Resend keeps an idempotency key. */
export const IDEMPOTENCY_KEY_LIFETIME_MS = 24 * 60 * 60 * 1_000;

/** One request the stub received, valid or not. */
export type ResendStubRequest = {
  method: string;
  pathname: string;
  authorization: string | undefined;
  userAgent: string | undefined;
  idempotencyKey: string | undefined;
  /** The parsed JSON body; the raw text when it is not JSON, `undefined` without one. */
  body: unknown;
};

/** An email the stub sent: one per idempotency key within the key's lifetime, as Resend sends. */
export type SentEmail = {
  id: string;
  idempotencyKey: string | undefined;
  /** The request body that sent it. */
  email: unknown;
};

export type ScriptedResponse = {
  status: number;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent verbatim instead of `body`, such as a malformed or HTML error page. */
  rawBody?: string;
  headers?: Record<string, string>;
};

/** A request the stub holds open until the test releases it. */
export type HeldRequest = {
  /** Resolves once the held request has arrived; a ledger hold has put its key in flight by then. */
  received: Promise<void>;
  release(): void;
};

export type ResendStub = {
  /** The stub's origin on 127.0.0.1, for `RESEND_BASE_URL`. */
  url: string;
  /** Every request, in arrival order. */
  requests: readonly ResendStubRequest[];
  /** The ledger's sent emails, in the order they were sent. */
  emails: readonly SentEmail[];
  /** Answers the next valid request with this response instead of the ledger; it sends nothing. */
  respondNext(response: ScriptedResponse): void;
  /** Never answers the next valid request, as an unresponsive Resend would; it sends nothing. */
  hangNext(): void;
  /**
   * Holds the next valid request open until the test releases it. Without `response` the request
   * runs through the ledger: its key is in flight while held and the email is sent on release, even
   * when the client has given up by then (a send whose response is lost). With `response` it is
   * answered that way on release and sends nothing.
   */
  holdNext(response?: ScriptedResponse): HeldRequest;
  close(): Promise<void>;
};

export type ResendStubOptions = {
  /** The clock for idempotency key expiry, in epoch milliseconds; defaults to the system clock. */
  now?: () => number;
};

/** A response in Resend's error shape. */
export function resendError(status: number, name: string, message: string): ScriptedResponse {
  return { status, body: { statusCode: status, name, message } };
}

type Override =
  | { kind: "RESPOND"; response: ScriptedResponse }
  | { kind: "HANG" }
  | {
      kind: "HOLD";
      markReceived(): void;
      released: Promise<void>;
      response: ScriptedResponse | undefined;
    };

type LedgerEntry = { email: unknown; firstRequestMs: number } & (
  | { state: "IN_FLIGHT" }
  | { state: "SENT"; id: string }
);

/** Starts a stub on 127.0.0.1 on a port the OS assigns; the caller closes it. */
export async function startResendStub(options: ResendStubOptions = {}): Promise<ResendStub> {
  const now = options.now ?? (() => Temporal.Now.instant().epochMilliseconds);
  const requests: ResendStubRequest[] = [];
  const emails: SentEmail[] = [];
  const overrides: Override[] = [];
  const ledger = new Map<string, LedgerEntry>();

  const server = http.createServer((request, response) => {
    void handleRequest(request, response);
  });

  async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const text = await readText(request);
    const idempotencyKey = request.headers["idempotency-key"];
    assert(!Array.isArray(idempotencyKey), "A request carries more than one Idempotency-Key.");
    const body = parseBody(text);
    requests.push({
      method: request.method ?? "GET",
      pathname: requestUrl.pathname,
      authorization: request.headers.authorization,
      userAgent: request.headers["user-agent"],
      idempotencyKey,
      body,
    });

    const refusal = refuse(request, requestUrl, idempotencyKey, body);
    if (refusal !== undefined) {
      respond(response, refusal);
      return;
    }

    const override = overrides.shift();
    if (override?.kind === "RESPOND") {
      respond(response, override.response);
      return;
    }
    if (override?.kind === "HANG") {
      return;
    }
    if (override?.kind === "HOLD" && override.response !== undefined) {
      override.markReceived();
      await override.released;
      respond(response, override.response);
      return;
    }
    respond(response, await send(idempotencyKey, body, override));
  }

  /** Runs a valid request through the ledger, held until released when `hold` is given. */
  async function send(
    idempotencyKey: string | undefined,
    body: unknown,
    hold: Extract<Override, { kind: "HOLD" }> | undefined,
  ): Promise<ScriptedResponse> {
    const entry = idempotencyKey === undefined ? undefined : ledger.get(idempotencyKey);
    if (entry !== undefined && now() < entry.firstRequestMs + IDEMPOTENCY_KEY_LIFETIME_MS) {
      hold?.markReceived();
      await hold?.released;
      return answerReplay(entry, body);
    }

    const firstRequestMs = now();
    if (idempotencyKey !== undefined) {
      ledger.set(idempotencyKey, { state: "IN_FLIGHT", email: body, firstRequestMs });
    }
    hold?.markReceived();
    await hold?.released;

    const id = crypto.randomUUID();
    if (idempotencyKey !== undefined) {
      ledger.set(idempotencyKey, { state: "SENT", id, email: body, firstRequestMs });
    }
    emails.push({ id, idempotencyKey, email: body });
    return { status: 200, body: { id } };
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(typeof address === "object" && address !== null, "The stub listens on no TCP port.");

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    emails,
    respondNext: (response) => {
      overrides.push({ kind: "RESPOND", response });
    },
    hangNext: () => {
      overrides.push({ kind: "HANG" });
    },
    holdNext: (response) => {
      const received = Promise.withResolvers<void>();
      const released = Promise.withResolvers<void>();
      overrides.push({
        kind: "HOLD",
        markReceived: received.resolve,
        released: released.promise,
        response,
      });
      return { received: received.promise, release: released.resolve };
    },
    close: async () => {
      // Hung and held requests would otherwise keep `close()` waiting forever.
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    },
  };
}

/**
 * Starts a stub and closes it when the test finishes. Pass `onTestFinished` from the test's own
 * context, so that concurrent tests each close their own stub.
 */
export async function useResendStub(
  { onTestFinished }: { onTestFinished: (listener: () => Promise<void>) => void },
  options: ResendStubOptions = {},
): Promise<ResendStub> {
  const stub = await startResendStub(options);
  onTestFinished(() => stub.close());
  return stub;
}

/** Resend's refusal of a request it never runs, or `undefined` for a valid send request. */
function refuse(
  request: http.IncomingMessage,
  requestUrl: URL,
  idempotencyKey: string | undefined,
  body: unknown,
): ScriptedResponse | undefined {
  if (request.method !== "POST" || requestUrl.pathname !== "/emails") {
    return resendError(404, "not_found", "The requested endpoint does not exist.");
  }
  if (request.headers.authorization === undefined) {
    return resendError(401, "missing_api_key", "Missing API key in the authorization header.");
  }
  if (request.headers["user-agent"] === undefined) {
    return resendError(403, "validation_error", "Missing User-Agent header.");
  }
  if (idempotencyKey !== undefined && (idempotencyKey.length < 1 || idempotencyKey.length > 256)) {
    return resendError(400, "invalid_idempotency_key", "The key must be between 1-256 chars.");
  }
  const missingField = ["from", "to", "subject"].find(
    (field) => typeof body !== "object" || body === null || !(field in body),
  );
  if (missingField !== undefined) {
    return resendError(422, "missing_required_field", `Missing \`${missingField}\` field.`);
  }
  return undefined;
}

/** Resend's answer to a key it still keeps. */
function answerReplay(entry: LedgerEntry, body: unknown): ScriptedResponse {
  if (entry.state === "IN_FLIGHT") {
    return resendError(
      409,
      "concurrent_idempotent_requests",
      "Same idempotency key used while original request is still in progress.",
    );
  }
  if (!util.isDeepStrictEqual(entry.email, body)) {
    return resendError(
      409,
      "invalid_idempotent_request",
      "This idempotency key has been used with this HTTP method and endpoint within the last 24 hours, but the request body was modified.",
    );
  }
  return { status: 200, body: { id: entry.id } };
}

function respond(response: http.ServerResponse, scripted: ScriptedResponse) {
  // A client that gave up, such as one whose timeout fired during a hold, gets no answer.
  if (response.destroyed) {
    return;
  }
  const { status, body, rawBody, headers } = scripted;
  if (rawBody !== undefined) {
    response.writeHead(status, headers).end(rawBody);
    return;
  }
  if (body === undefined) {
    response.writeHead(status, headers).end();
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function parseBody(text: string): unknown {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readText(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
