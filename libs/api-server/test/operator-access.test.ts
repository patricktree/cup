import { expect, test, vi } from "vitest";

import type {
  AccountAccountingInspection,
  AccountArtifactWriter,
  AccountConversionDeletion,
  AccountHistoryPage,
  AccountSnapshot,
} from "@cup/accounts/contracts";
import {
  LOCAL_OPERATOR_ACCESS_TOKEN,
  adjustAccountAllowanceResponseSchema,
  inspectAccountResponseSchema,
  listAccountDeletionsResponseSchema,
  listAccountsResponseSchema,
  type ListAccountDeletionsResponse,
} from "@cup/operator-api.routes";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { createApiServer } from "#src/api-server.ts";
import { isDevelopmentOperatorRequest } from "#src/http/operator-access.ts";

vi.mock("@cup/conversion-grants", async () => ({
  ...(await import("@cup/conversion-grants/contracts")),
  clearGrantSessionCookie: () => "",
  createGrantSessionCookie: () => "",
  createRootCredential: () => "",
  getGrantSessionCookie: () => undefined,
}));

const accountId = "d1a52e64-3e4d-4a7f-a711-7fb11501e9af";
const conversionId = "f9cc2e59-46a3-4890-b923-bda04d03b4d0";
const balance = { unit: "audio-millisecond", available: 1_800_000, reserved: 0 } as const;
// Typed by the account's result types rather than the operator contract, so the fixture can hold
// anything the account returns, including cover images, derived statuses, and the balance unit,
// and the strict parse of the response checks that the contract accepts it.
const inspection: {
  account: AccountSnapshot;
  accounting: AccountAccountingInspection;
  history: AccountHistoryPage;
  writers: AccountArtifactWriter[];
  conversionDeletions: AccountConversionDeletion[];
} = {
  account: {
    accountId,
    subject: accountId,
    createdAtMs: 1,
    state: "active",
    executionEpoch: 1,
    recoveryDeadlineMs: null,
    balance,
  },
  accounting: { balance, reconstructed: { available: 1_800_000, reserved: 0 }, entries: 1 },
  history: {
    items: [
      {
        conversionId,
        idempotencyKey: conversionId,
        sourceUrl: "https://example.com/book",
        createdAtMs: 1,
        status: "ready",
        lastStartedPhase: "finalization",
        completedAtMs: 2,
        outcome: {
          status: "ready",
          title: "Book",
          audiobookReference: {
            key: "manifest.json",
            contentType: "application/json",
            byteLength: 12,
            etag: "etag",
          },
          hasCoverImage: true,
        },
      },
      {
        conversionId: "2d8c1f4e-6b1a-4c3e-9f2a-7e5d4c3b2a19",
        idempotencyKey: "2d8c1f4e-6b1a-4c3e-9f2a-7e5d4c3b2a19",
        sourceUrl: "https://example.com/partly-synthesized",
        createdAtMs: 1,
        status: "synthesizing",
        lastStartedPhase: "finalization",
        completedAtMs: 2,
        outcome: {
          status: "ready",
          title: "Partly synthesized",
          audiobookReference: {
            key: "manifest.json",
            contentType: "application/json",
            byteLength: 12,
            etag: "etag",
          },
        },
      },
      {
        conversionId: "8a7b6c5d-4e3f-4a1b-8c9d-0e1f2a3b4c5d",
        idempotencyKey: "8a7b6c5d-4e3f-4a1b-8c9d-0e1f2a3b4c5d",
        sourceUrl: "https://example.com/over-allowance",
        createdAtMs: 1,
        status: "insufficient-duration",
        lastStartedPhase: "finalization",
        completedAtMs: 2,
        outcome: {
          status: "ready",
          title: "Over allowance",
          audiobookReference: {
            key: "manifest.json",
            contentType: "application/json",
            byteLength: 12,
            etag: "etag",
          },
        },
      },
    ],
    nextCursor: null,
  },
  writers: [
    {
      writerId: "writer",
      prefix: "accounts/example/",
      state: "running",
      effect: "put:manifest.json",
    },
  ],
  conversionDeletions: [
    { conversionId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f", deletingSinceMs: 1_767_225_600_000 },
  ],
};
const deletions: ListAccountDeletionsResponse = {
  attempts: [
    {
      attemptId: conversionId,
      accountId,
      state: "deleting",
      identityDone: true,
      accountDone: false,
      failures: 1,
      overdue: true,
    },
  ],
  receipts: [
    { attemptId: accountId, completedAtMs: 1, expiresAtMs: 2, result: '{"account":"erased"}' },
  ],
};

const identity = {
  subject: "6c1f9e4a-2b7d-4e8f-9a3c-5d6e7f8a9b0c",
  accountId,
  createdAtMs: 1_767_225_600_000,
  phase: "active",
} as const;
const projectedIdentity = {
  subject: "7d2a0f5b-3c8e-4f9a-8b4d-6e7f8a9b0c1d",
  accountId: "e2b63f75-4f5e-4b8a-b822-8ac22612fab0",
  createdAtMs: 1_767_225_600_000,
  phase: "active",
  usage: {
    revision: 7,
    allowanceMilliseconds: 1_800_000,
    reservedMilliseconds: 600_000,
    spentMilliseconds: 1_500_000,
    schemaVersion: 1,
    availableMilliseconds: 0,
  },
} as const;

type DeleteConversionResult = {
  result: "marked" | "already-marked" | "not-found" | "account-unavailable";
};
type ConversionOwner = { kind: "trial"; grantId: string } | { kind: "account"; accountId: string };

function fixture() {
  const deleteConversion = vi.fn<(id: string) => Promise<DeleteConversionResult>>(async () => ({
    result: "marked",
  }));
  const findConversionOwner = vi.fn<(id: string) => Promise<ConversionOwner | undefined>>(
    async () => ({ kind: "account", accountId }),
  );
  const readAccount = vi.fn<() => Promise<AccountSnapshot>>(async () => inspection.account);
  const adjustAllowance = vi.fn<
    (requestId: string, amount: number, cause: string) => Promise<void>
  >(async () => undefined);
  const listAccounts = vi.fn<
    (input: { phase?: string; limit: number; cursor?: string }) => Promise<{
      accounts: (typeof identity | typeof projectedIdentity)[];
      nextCursor?: string;
    }>
  >(async () => ({ accounts: [identity, projectedIdentity], nextCursor: "next" }));
  const findAccount = vi.fn<(id: string) => Promise<typeof identity | undefined>>(async (id) =>
    id === accountId ? identity : undefined,
  );
  const env = {
    SUPABASE_URL: "https://auth.example.test",
    ACCOUNTS: {
      idFromName: (name: string) => name,
      get: () => ({
        inspect: readAccount,
        inspectAccounting: async () => inspection.accounting,
        history: async () => inspection.history,
        inspectArtifactWriters: async () => inspection.writers,
        inspectConversionDeletions: async () => inspection.conversionDeletions,
        adjustAllowance,
        deleteConversion,
      }),
    },
    REGISTRY: {
      idFromName: (name: string) => name,
      get: () => ({
        inspectDeletions: async () => deletions.attempts,
        deletionReceipts: async () => deletions.receipts,
        listAccounts,
        findAccount,
        findConversionOwner,
      }),
    },
  };
  if (!isFixtureEnvironment(env)) {
    throw new Error("Invalid operator fixture");
  }
  return { env, readAccount, adjustAllowance, listAccounts, deleteConversion, findConversionOwner };
}

function adjustmentRequest(body: unknown, id = accountId) {
  return new Request(`https://cup.audio/api/operator/accounts/${id}/allowance-adjustments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteConversionRequest(id = conversionId) {
  return new Request(`https://cup.audio/api/operator/conversions/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

function isFixtureEnvironment(value: unknown): value is ApiServerEnvironment {
  return typeof value === "object" && value !== null && "ACCOUNTS" in value && "REGISTRY" in value;
}

test("typed operator account routes preserve complete inspection and deletion records", async () => {
  const { env } = fixture();
  const app = createApiServer({ validateOperatorAccess: async () => true });
  const account = await app.request(
    `https://cup.audio/api/operator/accounts/${accountId}`,
    {},
    env,
  );
  expect(account.status).toBe(200);
  expect(inspectAccountResponseSchema.parse(await account.json())).toEqual(inspection);
  const deletionList = await app.request(
    "https://cup.audio/api/operator/accounts/deletions",
    {},
    env,
  );
  expect(deletionList.status).toBe(200);
  expect(listAccountDeletionsResponseSchema.parse(await deletionList.json())).toEqual(deletions);
});

test("account routes remain behind operator authentication and reject invalid account IDs", async () => {
  const { env, readAccount } = fixture();
  const denied = createApiServer({ validateOperatorAccess: async () => false });
  for (const path of [accountId, "deletions"]) {
    expect(
      (await denied.request(`https://cup.audio/api/operator/accounts/${path}`, {}, env)).status,
    ).toBe(401);
  }
  expect(readAccount).not.toHaveBeenCalled();
  const app = createApiServer({ validateOperatorAccess: async () => true });
  expect(
    (await app.request("https://cup.audio/api/operator/accounts/invalid", {}, env)).status,
  ).toBe(404);
  expect(readAccount).not.toHaveBeenCalled();
});

test("lists registry accounts with ISO creation times, projected usage, and forwards pagination", async () => {
  const { env, listAccounts } = fixture();
  const app = createApiServer({ validateOperatorAccess: async () => true });
  const response = await app.request(
    "https://cup.audio/api/operator/accounts?phase=active&limit=10&cursor=abc",
    {},
    env,
  );
  expect(response.status).toBe(200);
  expect(listAccountsResponseSchema.parse(await response.json())).toEqual({
    accounts: [
      {
        accountId,
        subject: identity.subject,
        createdAt: "2026-01-01T00:00:00Z",
        phase: "active",
      },
      {
        accountId: projectedIdentity.accountId,
        subject: projectedIdentity.subject,
        createdAt: "2026-01-01T00:00:00Z",
        phase: "active",
        usage: {
          allowanceMilliseconds: 1_800_000,
          reservedMilliseconds: 600_000,
          spentMilliseconds: 1_500_000,
          availableMilliseconds: 0,
        },
      },
    ],
    nextCursor: "next",
  });
  expect(listAccounts).toHaveBeenCalledWith({ phase: "active", limit: 10, cursor: "abc" });

  for (const query of ["limit=0", "phase=deleted", "limit=1&limit=2"]) {
    expect(
      (await app.request(`https://cup.audio/api/operator/accounts?${query}`, {}, env)).status,
    ).toBe(400);
  }

  listAccounts.mockRejectedValueOnce(new Error("Invalid Registry cursor"));
  const invalidCursor = await app.request(
    "https://cup.audio/api/operator/accounts?cursor=bad",
    {},
    env,
  );
  expect(invalidCursor.status).toBe(400);
  expect(await invalidCursor.json()).toMatchObject({ error: { code: "invalid-cursor" } });
});

test("records account allowance adjustments and reports the resulting balance", async () => {
  const { env, adjustAllowance } = fixture();
  const app = createApiServer({ validateOperatorAccess: async () => true });
  const requestId = "0b8d3e8c-7f43-4c56-8e57-30cbb1ad7b1e";
  const response = await app.request(
    adjustmentRequest({ requestId, amountMilliseconds: -60_000, reason: " goodwill " }),
    {},
    env,
  );
  expect(response.status).toBe(200);
  expect(adjustAccountAllowanceResponseSchema.parse(await response.json())).toEqual({
    accountId,
    balance,
  });
  expect(adjustAllowance).toHaveBeenCalledWith(requestId, -60_000, "goodwill");
});

test("rejects account allowance adjustments for unknown accounts and invalid input", async () => {
  const { env, adjustAllowance } = fixture();
  const app = createApiServer({ validateOperatorAccess: async () => true });
  const requestId = "0b8d3e8c-7f43-4c56-8e57-30cbb1ad7b1e";
  const unknown = await app.request(
    adjustmentRequest(
      { requestId, amountMilliseconds: 60_000, reason: "refund" },
      "5f0f8d0e-3a7c-4f4e-9b0e-1f2a3b4c5d6e",
    ),
    {},
    env,
  );
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toMatchObject({ error: { code: "account-not-found" } });
  for (const body of [
    { requestId, amountMilliseconds: 0, reason: "refund" },
    { requestId, amountMilliseconds: 1.5, reason: "refund" },
    { requestId, amountMilliseconds: 60_000, reason: " " },
    { requestId: "not-a-uuid", amountMilliseconds: 60_000, reason: "refund" },
  ]) {
    expect((await app.request(adjustmentRequest(body), {}, env)).status).toBe(400);
  }
  expect(adjustAllowance).not.toHaveBeenCalled();
});

test.each([
  ["Account is not active", "account-not-active"],
  ["Account is not initialized", "account-not-active"],
  ["Allowance adjustment exceeds available duration", "adjustment-exceeds-available-duration"],
  ["Allowance adjustment idempotency conflict", "idempotency-conflict"],
])("maps the account ledger rejection %s to a conflict", async (message, code) => {
  const { env, adjustAllowance } = fixture();
  adjustAllowance.mockRejectedValueOnce(new Error(message));
  const app = createApiServer({ validateOperatorAccess: async () => true });
  const response = await app.request(
    adjustmentRequest({
      requestId: "0b8d3e8c-7f43-4c56-8e57-30cbb1ad7b1e",
      amountMilliseconds: -60_000,
      reason: "correction",
    }),
    {},
    env,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code } });
});

test("reports unexpected adjustment failures as JSON operational errors", async () => {
  const { env, adjustAllowance } = fixture();
  adjustAllowance.mockRejectedValueOnce(new Error("Storage unavailable"));
  const app = createApiServer({ validateOperatorAccess: async () => true });
  const response = await app.request(
    adjustmentRequest({
      requestId: "0b8d3e8c-7f43-4c56-8e57-30cbb1ad7b1e",
      amountMilliseconds: 60_000,
      reason: "refund",
    }),
    {},
    env,
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ error: { code: "operational-error" } });
});

test("account listing and adjustment remain behind operator authentication", async () => {
  const { env, adjustAllowance, listAccounts } = fixture();
  const denied = createApiServer({ validateOperatorAccess: async () => false });
  expect((await denied.request("https://cup.audio/api/operator/accounts", {}, env)).status).toBe(
    401,
  );
  expect(
    (
      await denied.request(
        adjustmentRequest({
          requestId: "0b8d3e8c-7f43-4c56-8e57-30cbb1ad7b1e",
          amountMilliseconds: 60_000,
          reason: "refund",
        }),
        {},
        env,
      )
    ).status,
  ).toBe(401);
  expect(listAccounts).not.toHaveBeenCalled();
  expect(adjustAllowance).not.toHaveBeenCalled();
});

test("deletes an account-owned conversion with 204 and names the owning account, also on a repeat", async () => {
  const { env, deleteConversion, findConversionOwner } = fixture();
  const app = createApiServer({ validateOperatorAccess: async () => true });

  const first = await app.request(deleteConversionRequest(), {}, env);
  expect(first.status).toBe(204);
  expect(first.headers.get("X-Account-Id")).toBe(accountId);

  deleteConversion.mockResolvedValueOnce({ result: "already-marked" });
  const repeat = await app.request(deleteConversionRequest(), {}, env);
  expect(repeat.status).toBe(204);
  expect(repeat.headers.get("X-Account-Id")).toBe(accountId);

  expect(findConversionOwner).toHaveBeenCalledWith(conversionId);
  expect(deleteConversion).toHaveBeenCalledTimes(2);
  expect(deleteConversion).toHaveBeenCalledWith(conversionId);
});

test("refuses to delete a conversion without an owner or with a trial owner", async () => {
  const { env, deleteConversion, findConversionOwner } = fixture();
  const app = createApiServer({ validateOperatorAccess: async () => true });

  findConversionOwner.mockResolvedValueOnce(undefined);
  const unknown = await app.request(deleteConversionRequest(), {}, env);
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toMatchObject({ error: { code: "conversion-not-found" } });

  findConversionOwner.mockResolvedValueOnce({
    kind: "trial",
    grantId: "0b8d3e8c-7f43-4c56-8e57-30cbb1ad7b1e",
  });
  const trial = await app.request(deleteConversionRequest(), {}, env);
  expect(trial.status).toBe(409);
  expect(await trial.json()).toMatchObject({ error: { code: "conversion-not-account-owned" } });

  expect(deleteConversion).not.toHaveBeenCalled();
});

test.each([
  ["account-unavailable", 409, "account-unavailable"],
  ["not-found", 404, "conversion-not-found"],
] as const)("maps the account's %s deletion result to %i %s", async (result, status, code) => {
  const { env, deleteConversion } = fixture();
  deleteConversion.mockResolvedValueOnce({ result });
  const app = createApiServer({ validateOperatorAccess: async () => true });

  const response = await app.request(deleteConversionRequest(), {}, env);

  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
});

test("conversion deletion stays behind operator authentication and rejects invalid IDs and methods", async () => {
  const { env, deleteConversion, findConversionOwner } = fixture();
  const denied = createApiServer({ validateOperatorAccess: async () => false });
  expect((await denied.request(deleteConversionRequest(), {}, env)).status).toBe(401);

  const app = createApiServer({ validateOperatorAccess: async () => true });
  expect((await app.request(deleteConversionRequest("not-a-uuid"), {}, env)).status).toBe(400);
  expect(
    (
      await app.request(
        `https://cup.audio/api/operator/conversions/${conversionId}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        env,
      )
    ).status,
  ).toBe(405);

  expect(findConversionOwner).not.toHaveBeenCalled();
  expect(deleteConversion).not.toHaveBeenCalled();
});

test("accepts the local operator token on loopback URLs", () => {
  const request = new Request("http://localhost/api/operator/grants", {
    headers: { "Cf-Access-Token": LOCAL_OPERATOR_ACCESS_TOKEN },
  });

  expect(isDevelopmentOperatorRequest(request)).toBe(true);
});

test("accepts the local operator token on Tailnet URLs", () => {
  const request = new Request(
    "http://macbook-pro-pkerschbaum.oberhasli-universe.ts.net:5173/api/operator/grants",
    { headers: { "Cf-Access-Token": LOCAL_OPERATOR_ACCESS_TOKEN } },
  );

  expect(isDevelopmentOperatorRequest(request)).toBe(true);
});

test.each([
  ["a missing token", "http://localhost/api/operator/not-found", undefined],
  [
    "the local token on a deployed URL",
    "https://example.com/api/operator/not-found",
    LOCAL_OPERATOR_ACCESS_TOKEN,
  ],
])("rejects %s", (_description, url, accessToken) => {
  const request = new Request(
    url,
    accessToken === undefined ? undefined : { headers: { "Cf-Access-Token": accessToken } },
  );

  expect(isDevelopmentOperatorRequest(request)).toBe(false);
});
