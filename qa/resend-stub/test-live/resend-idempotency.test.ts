/*
 * The live Resend contract test, opt-in through `pnpm test:resend-live` and part of no validation
 * command. It checks what no local test can: that the Resend stub's model matches the real API.
 * Every test sends real emails, to `delivered@resend.dev` only, under a fresh idempotency key.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import https from "node:https";
import { test } from "vitest";

const RESEND_BASE_URL = "https://api.resend.com";
/** The sender of deletion notices in `libs/registry/src/providers/resend-email.ts`. */
const DEFAULT_FROM = "Cup <no-reply@cup.audio>";

const resendApiKey = process.env["RESEND_API_KEY"] ?? "";
if (resendApiKey === "") {
  throw new Error(
    `pnpm test:resend-live needs RESEND_API_KEY, a Resend API key with sending access; it sends real emails to delivered@resend.dev. RESEND_FROM is optional and defaults to ${DEFAULT_FROM}.`,
  );
}
const resendFrom = process.env["RESEND_FROM"] || DEFAULT_FROM;

test("the same key with the same body returns the same email id", async ({ expect }) => {
  const idempotencyKey = createIdempotencyKey();
  const email = createEmail();

  const first = await postEmail(idempotencyKey, email);
  const replay = await postEmail(idempotencyKey, email);

  expect(first.status).toBe(200);
  expect(replay.status).toBe(200);
  expect(replay.body).toStrictEqual({ id: readEmailId(first.body) });
});

test("the same key with a different body answers 409 invalid_idempotent_request", async ({
  expect,
}) => {
  const idempotencyKey = createIdempotencyKey();
  const email = createEmail();

  const first = await postEmail(idempotencyKey, email);
  const modified = await postEmail(idempotencyKey, {
    ...email,
    subject: `${email.subject}, modified`,
  });

  expect(first.status).toBe(200);
  expect(modified.status).toBe(409);
  expect(modified.body).toMatchObject({ name: "invalid_idempotent_request" });
});

test("two concurrent requests with the same key give one success and one 409 concurrent_idempotent_requests, or the same id twice", async ({
  expect,
}) => {
  const idempotencyKey = createIdempotencyKey();
  const email = createEmail();

  const responses = await Promise.all([
    postEmail(idempotencyKey, email),
    postEmail(idempotencyKey, email),
  ]);

  const successes = responses.filter(({ status }) => status === 200);
  const conflicts = responses.filter(({ status }) => status === 409);
  if (successes.length === 2) {
    expect(successes[1]?.body).toStrictEqual({ id: readEmailId(successes[0]?.body) });
  } else {
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.body).toMatchObject({ name: "concurrent_idempotent_requests" });
  }
});

test("a request without User-Agent is refused with 403", async ({ expect }) => {
  const response = await postWithoutUserAgent(createIdempotencyKey(), createEmail());

  expect(response.status).toBe(403);
});

function createIdempotencyKey(): string {
  return `cup-live-test/${crypto.randomUUID()}`;
}

/** An email shaped like the deletion notices the deletion coordinator sends. */
function createEmail() {
  return {
    from: resendFrom,
    to: ["delivered@resend.dev"],
    subject: `Cup live contract test ${crypto.randomUUID()}`,
    text: "Sent by pnpm test:resend-live.",
  };
}

async function postEmail(
  idempotencyKey: string,
  email: ReturnType<typeof createEmail>,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${RESEND_BASE_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "User-Agent": "cup-live-test",
    },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

/** `fetch` always sends a User-Agent, so this request goes through `node:https`. */
async function postWithoutUserAgent(
  idempotencyKey: string,
  email: ReturnType<typeof createEmail>,
): Promise<{ status: number | undefined }> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      `${RESEND_BASE_URL}/emails`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        timeout: 10_000,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ status: response.statusCode }));
      },
    );
    request.on("timeout", () => request.destroy(new Error("Resend did not answer in time")));
    request.on("error", reject);
    request.end(JSON.stringify(email));
  });
}

function readEmailId(body: unknown): string {
  assert(
    typeof body === "object" && body !== null && "id" in body && typeof body.id === "string",
    `Resend answered without an email id: ${JSON.stringify(body)}`,
  );
  return body.id;
}
