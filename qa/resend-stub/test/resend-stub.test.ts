import assert from "node:assert/strict";
import http from "node:http";
import { test } from "vitest";

import {
  IDEMPOTENCY_KEY_LIFETIME_MS,
  resendError,
  useResendStub,
  type ResendStub,
} from "#src/resend-stub.ts";

const EMAIL = {
  from: "Cup <no-reply@cup.audio>",
  to: ["listener@example.com"],
  subject: "Your Cup account deletion is scheduled",
  text: "Your Cup account is scheduled for deletion.",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("a new idempotency key sends the email: 200 with a new id, and the ledger records it", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });

  const response = await postEmail(stub, "key-1", EMAIL);

  expect(response.status).toBe(200);
  const id = await readEmailId(response);
  expect(id).toMatch(UUID_PATTERN);
  expect(stub.emails).toStrictEqual([{ id, idempotencyKey: "key-1", email: EMAIL }]);
  expect(stub.requests).toStrictEqual([
    {
      method: "POST",
      pathname: "/emails",
      authorization: "Bearer re_test",
      userAgent: "cup-test",
      idempotencyKey: "key-1",
      body: EMAIL,
    },
  ]);
});

test("the same key with the same body returns the original id and sends nothing new", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const firstId = await readEmailId(await postEmail(stub, "key-1", EMAIL));

  const replay = await postEmail(stub, "key-1", { ...EMAIL });

  expect(replay.status).toBe(200);
  expect(await replay.json()).toStrictEqual({ id: firstId });
  expect(stub.emails).toHaveLength(1);
});

test("the same key with a different body answers 409 invalid_idempotent_request", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  await postEmail(stub, "key-1", EMAIL);

  const response = await postEmail(stub, "key-1", { ...EMAIL, subject: "Changed" });

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    statusCode: 409,
    name: "invalid_idempotent_request",
  });
  expect(stub.emails).toHaveLength(1);
});

test("the same key while the first request is in flight answers 409 concurrent_idempotent_requests", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const held = stub.holdNext();
  const first = postEmail(stub, "key-1", EMAIL);
  await held.received;

  const concurrent = await postEmail(stub, "key-1", EMAIL);

  expect(concurrent.status).toBe(409);
  expect(await concurrent.json()).toMatchObject({ name: "concurrent_idempotent_requests" });
  expect(stub.emails).toStrictEqual([]);
  held.release();
  const firstResponse = await first;
  expect(firstResponse.status).toBe(200);
  const id = await readEmailId(firstResponse);
  expect(stub.emails).toStrictEqual([{ id, idempotencyKey: "key-1", email: EMAIL }]);
});

test("a held replay answers from the ledger as it stands on release", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const heldFirst = stub.holdNext();
  const heldReplay = stub.holdNext();
  const first = postEmail(stub, "key-1", EMAIL);
  await heldFirst.received;
  const replay = postEmail(stub, "key-1", EMAIL);
  await heldReplay.received;

  heldFirst.release();
  const id = await readEmailId(await first);
  heldReplay.release();

  expect(await readEmailId(await replay)).toBe(id);
  expect(stub.emails).toHaveLength(1);
});

test("a key is kept for 24 hours from its first request; after that the same request sends again", async ({
  expect,
  onTestFinished,
}) => {
  let nowMs = 1_000_000;
  const stub = await useResendStub({ onTestFinished }, { now: () => nowMs });
  const firstId = await readEmailId(await postEmail(stub, "key-1", EMAIL));

  nowMs += IDEMPOTENCY_KEY_LIFETIME_MS - 1;
  expect(await readEmailId(await postEmail(stub, "key-1", EMAIL))).toBe(firstId);
  nowMs += 1;
  const afterExpiry = await readEmailId(await postEmail(stub, "key-1", EMAIL));

  expect(afterExpiry).not.toBe(firstId);
  expect(stub.emails.map(({ id }) => id)).toStrictEqual([firstId, afterExpiry]);
});

test("a client that gives up during a hold loses the response, but the email is sent on release", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const held = stub.holdNext();
  const controller = new AbortController();
  const lost = postEmail(stub, "key-1", EMAIL, controller.signal);
  await held.received;

  controller.abort();
  await expect(lost).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
  held.release();
  await expect.poll(() => stub.emails).toHaveLength(1);
  const replay = await postEmail(stub, "key-1", EMAIL);

  expect(await readEmailId(replay)).toBe(stub.emails[0]?.id);
  expect(stub.emails).toHaveLength(1);
});

test("different keys send different emails", async ({ expect, onTestFinished }) => {
  const stub = await useResendStub({ onTestFinished });

  await postEmail(stub, "key-1", EMAIL);
  await postEmail(stub, "key-2", EMAIL);

  expect(stub.emails.map(({ idempotencyKey }) => idempotencyKey)).toStrictEqual(["key-1", "key-2"]);
  expect(new Set(stub.emails.map(({ id }) => id)).size).toBe(2);
});

test("scripted responses answer the next requests in order, then the ledger answers again", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  stub.respondNext({
    ...resendError(429, "rate_limit_exceeded", "Too many requests."),
    headers: { "Retry-After": "7" },
  });
  stub.respondNext({
    status: 502,
    rawBody: "<html>Bad gateway</html>",
    headers: { "Content-Type": "text/html" },
  });

  const limited = await postEmail(stub, "key-1", EMAIL);
  const badGateway = await postEmail(stub, "key-1", EMAIL);
  const accepted = await postEmail(stub, "key-1", EMAIL);

  expect(limited.status).toBe(429);
  expect(limited.headers.get("Retry-After")).toBe("7");
  expect(await limited.json()).toStrictEqual({
    statusCode: 429,
    name: "rate_limit_exceeded",
    message: "Too many requests.",
  });
  expect(badGateway.status).toBe(502);
  expect(await badGateway.text()).toBe("<html>Bad gateway</html>");
  expect(accepted.status).toBe(200);
  expect(stub.emails).toHaveLength(1);
  expect(stub.requests).toHaveLength(3);
});

test("a held request with a scripted response gets that response once released, and sends nothing", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const held = stub.holdNext(resendError(422, "validation_error", "Invalid `to` field."));
  const refused = postEmail(stub, "key-1", EMAIL);
  await held.received;
  const STILL_HELD = "still held";

  const earlyAnswer = await Promise.race([
    refused,
    new Promise((resolve) => setTimeout(() => resolve(STILL_HELD), 50)),
  ]);
  expect(earlyAnswer).toBe(STILL_HELD);
  held.release();
  const response = await refused;

  expect(response.status).toBe(422);
  expect(stub.emails).toStrictEqual([]);
  // The key never reached the ledger, so the next request with it sends the email.
  expect((await postEmail(stub, "key-1", EMAIL)).status).toBe(200);
  expect(stub.emails).toHaveLength(1);
});

test("a hung request never gets an answer and sends nothing", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  stub.hangNext();

  const hung = postEmail(stub, "key-1", EMAIL, AbortSignal.timeout(200));

  await expect(hung).rejects.toThrow(expect.objectContaining({ name: "TimeoutError" }));
  expect(stub.requests).toHaveLength(1);
  expect(stub.emails).toStrictEqual([]);
});

test("a request without User-Agent is refused with 403 and leaves no trace on its key", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });

  const refused = await postWithoutUserAgent(stub, "key-1", EMAIL);

  expect(refused).toMatchObject({ status: 403, body: { name: "validation_error" } });
  expect(stub.emails).toStrictEqual([]);
  expect((await postEmail(stub, "key-1", EMAIL)).status).toBe(200);
});

test("Resend's request checks refuse invalid requests before scripted responses apply", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  stub.respondNext({ status: 500 });

  const unauthenticated = await fetch(`${stub.url}/emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(EMAIL),
  });
  const longKey = await postEmail(stub, "k".repeat(257), EMAIL);
  const missingSubject = await postEmail(stub, "key-1", { from: EMAIL.from, to: EMAIL.to });
  const otherRoute = await fetch(`${stub.url}/emails/batch`, { method: "POST", body: "[]" });
  const scripted = await postEmail(stub, "key-1", EMAIL);

  expect(await unauthenticated.json()).toMatchObject({ statusCode: 401, name: "missing_api_key" });
  expect(await longKey.json()).toMatchObject({ statusCode: 400, name: "invalid_idempotency_key" });
  expect(await missingSubject.json()).toMatchObject({
    statusCode: 422,
    name: "missing_required_field",
  });
  expect(await otherRoute.json()).toMatchObject({ statusCode: 404, name: "not_found" });
  expect(scripted.status).toBe(500);
  expect(stub.emails).toStrictEqual([]);
});

async function postEmail(
  stub: ResendStub,
  idempotencyKey: string,
  email: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${stub.url}/emails`, {
    method: "POST",
    headers: {
      Authorization: "Bearer re_test",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "User-Agent": "cup-test",
    },
    body: JSON.stringify(email),
    ...(signal === undefined ? {} : { signal }),
  });
}

/** `fetch` always sends a User-Agent, so this request goes through `node:http`. */
async function postWithoutUserAgent(
  stub: ResendStub,
  idempotencyKey: string,
  email: unknown,
): Promise<{ status: number | undefined; body: unknown }> {
  const payload = JSON.stringify(email);
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${stub.url}/emails`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer re_test",
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

async function readEmailId(response: Response): Promise<string> {
  const body: unknown = await response.json();
  assert(
    typeof body === "object" && body !== null && "id" in body && typeof body.id === "string",
    "The response carries no email id.",
  );
  return body.id;
}
