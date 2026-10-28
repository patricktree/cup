/*
 * Deletion notices against a Resend stub (`@cup/resend-stub`) on an OS-assigned port, and a restore
 * that lands on the coordinator while it awaits the account, pinned with the holding ACCOUNTS double.
 */

import nodeUrl from "node:url";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, test, type TestContext } from "vitest";
import { createTestHarness } from "wrangler";

import type { AccountDurableObject } from "@cup/accounts";
import type { DeletionAttempt } from "@cup/accounts/lifecycle";
import { resendError, useResendStub, type ResendStub } from "@cup/resend-stub";

import type { DeletionTestDurableObject } from "#test/worker.ts";

type TestEnvironment = {
  ACCOUNTS: DurableObjectNamespace<AccountDurableObject>;
  DELETION_TEST: DurableObjectNamespace<DeletionTestDurableObject>;
};

/** The provider timeout for tests that hang or hold a request; the production timeout is 10 s. */
const SHORT_TIMEOUT_MS = 300;
/** Generous enough for a loaded machine, for tests whose requests get an answer. */
const DEFAULT_TIMEOUT_MS = 5_000;
const RECIPIENT = "listener@example.com";

const harness = createTestHarness({
  root: nodeUrl.fileURLToPath(new URL("..", import.meta.url)),
  workers: [{ configPath: "./wrangler.test.jsonc" }],
});
const worker = harness.getWorker();
let bindings: TestEnvironment;

beforeAll(async () => {
  await harness.listen();
  const environment: unknown = await worker.getEnv();
  if (!isTestEnvironment(environment)) {
    throw new Error("Deletion test bindings unavailable");
  }
  bindings = environment;
}, 30_000);

afterAll(async () => {
  await harness.close();
});

test("a deletion notice is sent once with its notification key and then purged", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const coordinator = await scheduledCoordinator();

  await coordinator.reconcile(stub);

  expect(await coordinator.notification()).toMatchObject({ state: "sent", attempts: 1, email: "" });
  expect(stub.requests).toStrictEqual([
    {
      method: "POST",
      pathname: "/emails",
      authorization: "Bearer test-resend",
      userAgent: "cup",
      idempotencyKey: coordinator.key,
      body: {
        from: "Cup <no-reply@cup.audio>",
        to: [RECIPIENT],
        subject: "Your Cup account deletion is scheduled",
        text: expect.stringContaining('choose "Restore account"'),
      },
    },
  ]);
  expectExactlyOneEmail(expect, stub, coordinator.key);
});

test("a retry after a lost response replays the key and delivers exactly one email", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const coordinator = await scheduledCoordinator();
  const held = stub.holdNext();

  const reconciling = coordinator.reconcile(stub, SHORT_TIMEOUT_MS);
  await held.received;
  await reconciling;
  expect(await coordinator.notification()).toMatchObject({ state: "pending", attempts: 1 });
  // Resend finishes the send after the coordinator's timeout has given up on the response.
  held.release();
  await expect.poll(() => stub.emails).toHaveLength(1);
  await coordinator.makeNotificationDue();
  await coordinator.reconcile(stub);

  expect(await coordinator.notification()).toMatchObject({ state: "sent", attempts: 2 });
  expect(stub.requests).toHaveLength(2);
  expectExactlyOneEmail(expect, stub, coordinator.key);
});

test("a retry while the first request is still in progress gets 409 and retries again later", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const coordinator = await scheduledCoordinator();
  const held = stub.holdNext();
  const reconciling = coordinator.reconcile(stub, SHORT_TIMEOUT_MS);
  await held.received;
  await reconciling;

  await coordinator.makeNotificationDue();
  await coordinator.reconcile(stub, SHORT_TIMEOUT_MS);
  expect(await coordinator.notification()).toMatchObject({ state: "pending", attempts: 2 });
  held.release();
  await expect.poll(() => stub.emails).toHaveLength(1);
  await coordinator.makeNotificationDue();
  await coordinator.reconcile(stub);

  expect(await coordinator.notification()).toMatchObject({ state: "sent", attempts: 3 });
  expectExactlyOneEmail(expect, stub, coordinator.key);
});

test("a request timeout leaves the notice pending, and the retry delivers exactly one email", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const coordinator = await scheduledCoordinator();
  stub.hangNext();
  const before = Temporal.Now.instant().epochMilliseconds;

  await coordinator.reconcile(stub, SHORT_TIMEOUT_MS);

  const pending = await coordinator.notification();
  expect(pending).toMatchObject({ state: "pending", attempts: 1 });
  expect(pending.nextAttemptMs).toBeGreaterThanOrEqual(before + 60_000);
  expect(stub.emails).toStrictEqual([]);
  await coordinator.makeNotificationDue();
  await coordinator.reconcile(stub);
  expect(await coordinator.notification()).toMatchObject({ state: "sent", attempts: 2 });
  expectExactlyOneEmail(expect, stub, coordinator.key);
});

test("a final 4xx refusal fails the notice without retrying it", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const coordinator = await scheduledCoordinator();
  stub.respondNext(resendError(422, "validation_error", "Invalid `to` field."));

  await coordinator.reconcile(stub);
  await coordinator.makeNotificationDue();
  await coordinator.reconcile(stub);

  expect(await coordinator.notification()).toMatchObject({
    state: "failed",
    attempts: 1,
    email: "",
    text: "",
  });
  expect(stub.requests).toHaveLength(1);
  expect(stub.emails).toStrictEqual([]);
});

test.for([
  {
    name: "429 rate limit",
    response: {
      ...resendError(429, "rate_limit_exceeded", "Too many requests."),
      headers: { "Retry-After": "3600" },
    },
    retryAfterMs: 3_600_000,
  },
  {
    name: "503 with a non-JSON body",
    response: {
      status: 503,
      rawBody: "<html>Service unavailable</html>",
      headers: { "Content-Type": "text/html", "Retry-After": "120" },
    },
    retryAfterMs: 120_000,
  },
])(
  "a $name is retried no earlier than Retry-After and delivers exactly one email",
  async ({ response, retryAfterMs }, { expect, onTestFinished }) => {
    const stub = await useResendStub({ onTestFinished });
    const coordinator = await scheduledCoordinator();
    stub.respondNext(response);
    const before = Temporal.Now.instant().epochMilliseconds;

    await coordinator.reconcile(stub);

    const pending = await coordinator.notification();
    expect(pending).toMatchObject({ state: "pending", attempts: 1 });
    expect(pending.nextAttemptMs).toBeGreaterThanOrEqual(before + retryAfterMs);
    expect(stub.emails).toStrictEqual([]);
    await coordinator.makeNotificationDue();
    await coordinator.reconcile(stub);
    expect(await coordinator.notification()).toMatchObject({ state: "sent", attempts: 2 });
    expectExactlyOneEmail(expect, stub, coordinator.key);
  },
);

test("a restore accepted while the coordinator awaits the account fence supersedes the deletion", async ({
  expect,
  onTestFinished,
}) => {
  const stub = await useResendStub({ onTestFinished });
  const attempt = await restoredAccountAttempt();
  const name = crypto.randomUUID();
  const coordinator = bindings.DELETION_TEST.get(bindings.DELETION_TEST.idFromName(name));
  await coordinator.acceptForTest(attempt);
  const storage = await worker.getDurableObjectStorage("DELETION_TEST", { name });
  // The recovery period has ended in the coordinator's view, but the account was restored in time
  // and its restore delivery has not reached the coordinator yet.
  await storage.exec(
    "UPDATE deletion_jobs SET payload_json = json_set(payload_json, '$.nextAttemptMs', 0)",
  );
  await coordinator.holdNextAccountCallForTest("fenceDeletion");

  const reconciling = coordinator.reconcileWithProvidersForTest(stub.url, DEFAULT_TIMEOUT_MS);
  await coordinator.accountCallReachedForTest();
  await coordinator.acceptForTest({ ...attempt, state: "restored" });
  await coordinator.releaseAccountCallForTest();
  await reconciling;

  expect(await coordinator.statusForTest()).toStrictEqual([]);
  expect(await storage.exec("SELECT attempt_id FROM canceled_deletion_attempts")).toStrictEqual([
    { attempt_id: attempt.attemptId },
  ]);
  expect(stub.requests).toStrictEqual([]);
});

/** A coordinator holding one scheduled attempt whose scheduling notice is due. */
async function scheduledCoordinator() {
  const name = crypto.randomUUID();
  const object = bindings.DELETION_TEST.get(bindings.DELETION_TEST.idFromName(name));
  const nowMs = Temporal.Now.instant().epochMilliseconds;
  const attempt: DeletionAttempt = {
    attemptId: crypto.randomUUID(),
    accountId: crypto.randomUUID(),
    subject: crypto.randomUUID(),
    email: RECIPIENT,
    scheduledAtMs: nowMs,
    deadlineMs: nowMs + 7 * 86_400_000,
    state: "scheduled",
  };
  await object.acceptForTest(attempt);
  const storage = await worker.getDurableObjectStorage("DELETION_TEST", { name });
  const key = `${attempt.attemptId}:scheduled`;
  return {
    key,
    reconcile: (stub: ResendStub, timeoutMs = DEFAULT_TIMEOUT_MS) =>
      object.reconcileWithProvidersForTest(stub.url, timeoutMs),
    async notification() {
      const [row] = await storage.exec(
        `SELECT json_extract(payload_json, '$.state') AS state,
          json_extract(payload_json, '$.attempts') AS attempts,
          json_extract(payload_json, '$.nextAttemptMs') AS nextAttemptMs,
          json_extract(payload_json, '$.email') AS email,
          json_extract(payload_json, '$.text') AS text
        FROM deletion_notifications WHERE notification_key = ?`,
        key,
      );
      if (row === undefined) {
        throw new Error(`Notification ${key} is missing`);
      }
      return { ...row, nextAttemptMs: Number(row["nextAttemptMs"]) };
    },
    async makeNotificationDue() {
      await storage.exec(
        "UPDATE deletion_notifications SET payload_json = json_set(payload_json, '$.nextAttemptMs', 0) WHERE notification_key = ?",
        key,
      );
    },
  };
}

/** A real account whose deletion was scheduled and then restored, before the coordinator knew. */
async function restoredAccountAttempt(): Promise<DeletionAttempt> {
  const accountId = crypto.randomUUID();
  const account = bindings.ACCOUNTS.get(bindings.ACCOUNTS.idFromName(accountId));
  await account.initialize({
    accountId,
    subject: crypto.randomUUID(),
    createdAtMs: Temporal.Now.instant().epochMilliseconds,
  });
  // The account is initialized directly, so each registry delivery rejects after the state change.
  const schedule = await account.deletionChallenge();
  await expectRejection(
    account.scheduleDeletion({
      challengeId: schedule.challengeId,
      authenticatedAtSeconds: Math.floor(schedule.issuedAtMs / 1000) + 1,
      email: RECIPIENT,
    }),
  );
  const storage = await worker.getDurableObjectStorage("ACCOUNTS", { name: accountId });
  const [row] = await storage.exec("SELECT payload_json FROM deletion_attempts");
  const restore = await account.deletionChallenge();
  await expectRejection(
    account.restoreAccount(restore.challengeId, Math.floor(restore.issuedAtMs / 1000) + 1),
  );
  if ((await account.inspect()).state !== "active" || typeof row?.["payload_json"] !== "string") {
    throw new Error("The account was not scheduled for deletion and restored");
  }
  const scheduled: DeletionAttempt = JSON.parse(row["payload_json"]);
  return { ...scheduled, state: "scheduled" };
}

/**
 * The one "exactly once" assertion: the stub sent exactly one email, for this notification key, and
 * every request with the key carried the same body, so each retry was a replay of the first.
 */
function expectExactlyOneEmail(expect: TestContext["expect"], stub: ResendStub, key: string) {
  expect(stub.emails.map(({ idempotencyKey }) => idempotencyKey)).toStrictEqual([key]);
  const bodies = stub.requests
    .filter(({ idempotencyKey }) => idempotencyKey === key)
    .map(({ body }) => JSON.stringify(body));
  expect(new Set(bodies).size).toBe(1);
}

/** Wrangler hides the original rejection behind its RPC transport; state checks verify the effect. */
async function expectRejection(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch {
    return;
  }
  throw new Error("Expected the Durable Object operation to reject");
}

function isTestEnvironment(value: unknown): value is TestEnvironment {
  return (
    typeof value === "object" && value !== null && "ACCOUNTS" in value && "DELETION_TEST" in value
  );
}
