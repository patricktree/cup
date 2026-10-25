import { Temporal } from "temporal-polyfill";

import type { ProviderRequest } from "#src/providers/provider-request.ts";

export type ResendEnvironment = {
  RESEND_API_KEY: string;
  /** Resend API origin, such as `https://api.resend.com`. */
  RESEND_BASE_URL: string;
};
export type ResendEmail = {
  /** Resend deduplicates sends with the same key inside its deduplication window. */
  idempotencyKey: string;
  to: string;
  subject: string;
  text: string;
};
/** `rejected` is final; `retry` covers other failures, timeouts, and lost responses. */
export type ResendSendOutcome =
  | { kind: "sent" }
  | { kind: "rejected" }
  | { kind: "retry"; retryAfterMs: number };

/** Sends one email from Cup's address; `nowMs` anchors an HTTP-date `Retry-After`. */
export async function sendResendEmail(
  env: ResendEnvironment,
  email: ResendEmail,
  { request, timeoutMs }: ProviderRequest,
  nowMs: number,
): Promise<ResendSendOutcome> {
  let response: Response;
  try {
    response = await request(`${env.RESEND_BASE_URL}/emails`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey,
        // Resend refuses requests without a User-Agent with 403.
        "User-Agent": "cup",
      },
      body: JSON.stringify({
        from: "Cup <no-reply@cup.audio>",
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
    });
  } catch {
    return { kind: "retry", retryAfterMs: 0 };
  }
  let outcome: ResendSendOutcome;
  if (response.ok) {
    outcome = { kind: "sent" };
  } else if (
    response.status >= 400 &&
    response.status < 500 &&
    ![408, 409, 429].includes(response.status)
  ) {
    outcome = { kind: "rejected" };
  } else {
    const delay = response.headers.get("Retry-After");
    outcome = { kind: "retry", retryAfterMs: delay ? retryAfterDelay(delay, nowMs) : 0 };
  }
  try {
    await response.body?.cancel();
  } catch {
    /* The status already decided the outcome. */
  }
  return outcome;
}

function retryAfterDelay(value: string, nowMs: number) {
  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }
  const match = /^[A-Za-z]{3}, (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
    value,
  );
  if (!match) {
    return 0;
  }
  const month =
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(
      match[2]!,
    ) + 1;
  try {
    const date = Temporal.ZonedDateTime.from(
      {
        timeZone: "UTC",
        year: Number(match[3]),
        month,
        day: Number(match[1]),
        hour: Number(match[4]),
        minute: Number(match[5]),
        second: Number(match[6]),
      },
      { overflow: "reject" },
    );
    return Math.max(0, date.epochMilliseconds - nowMs);
  } catch {
    return 0;
  }
}
