import { expect, test, vi } from "vitest";

import {
  LOCAL_OPERATOR_ACCESS_TOKEN,
  inspectAccountResponseSchema,
  listAccountDeletionsResponseSchema,
  type InspectAccountResponse,
  type ListAccountDeletionsResponse,
} from "@cup/operator-api.routes";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { createApiServer } from "#src/api-server.ts";
import { isDevelopmentOperatorRequest } from "#src/operator-access.ts";

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
const inspection: InspectAccountResponse = {
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

function fixture() {
  const readAccount = vi.fn<() => Promise<InspectAccountResponse["account"]>>(
    async () => inspection.account,
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
      }),
    },
    REGISTRY: {
      idFromName: (name: string) => name,
      get: () => ({
        inspectDeletions: async () => deletions.attempts,
        deletionReceipts: async () => deletions.receipts,
      }),
    },
  };
  if (!isFixtureEnvironment(env)) throw new Error("Invalid operator fixture");
  return { env, readAccount };
}

function isFixtureEnvironment(value: unknown): value is ApiServerEnvironment {
  return typeof value === "object" && value !== null && "ACCOUNTS" in value && "REGISTRY" in value;
}

test("typed operator account routes preserve complete inspection and deletion records", async () => {
  const { env } = fixture();
  const app = createApiServer({ validateOperatorAccess: async () => true });
  const account = await app.request(
    `https://cup-audio.com/api/operator/accounts/${accountId}`,
    {},
    env,
  );
  expect(account.status).toBe(200);
  expect(inspectAccountResponseSchema.parse(await account.json())).toEqual(inspection);
  const deletionList = await app.request(
    "https://cup-audio.com/api/operator/accounts/deletions",
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
      (await denied.request(`https://cup-audio.com/api/operator/accounts/${path}`, {}, env)).status,
    ).toBe(401);
  }
  expect(readAccount).not.toHaveBeenCalled();
  const app = createApiServer({ validateOperatorAccess: async () => true });
  expect(
    (await app.request("https://cup-audio.com/api/operator/accounts/invalid", {}, env)).status,
  ).toBe(404);
  expect(readAccount).not.toHaveBeenCalled();
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
