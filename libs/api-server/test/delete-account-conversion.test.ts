import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, expect, test, vi } from "vitest";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { createApiServer } from "#src/api-server.ts";

vi.mock("@cup/conversion-grants", async () => ({
  ...(await import("@cup/conversion-grants/contracts")),
  clearGrantSessionCookie: () => "",
  createGrantSessionCookie: () => "",
  createRootCredential: () => "",
  getGrantSessionCookie: () => undefined,
}));

const accountId = "d1a52e64-3e4d-4a7f-a711-7fb11501e9af";
const otherAccountId = "5b0f6a3e-8d0e-4c51-9f0e-2a8f0c6f5d11";
const subject = "f355f913-ba12-45d6-a7d2-4df95f7cf11f";
const conversionId = "f9cc2e59-46a3-4890-b923-bda04d03b4d0";
const otherAccountConversionId = "0c6a9f53-35a4-4c1e-8e57-3f4f8f6c2a10";
const trialConversionId = "8e1d2b7a-6f43-4d0b-a2c9-1f5e7d3c9b20";
const url = "https://delete-test.supabase.co";
const keys = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "delete-conversion" };

afterEach(() => vi.unstubAllGlobals());

/** An account object that knows its own conversions and marks each one once, as the real one does. */
function createAccount(id: string, state: string, conversionIds: string[]) {
  const marked = new Set<string>();
  return {
    inspect: async () => ({
      accountId: id,
      subject,
      createdAtMs: 1,
      executionEpoch: 1,
      state,
      balance: { unit: "audio-millisecond", available: 1_800_000, reserved: 0 },
    }),
    deleteConversion: vi.fn<(requestedId: string) => Promise<{ result: string }>>(
      async (requestedId) => {
        if (!conversionIds.includes(requestedId)) {
          return { result: "not-found" };
        }
        if (marked.has(requestedId)) {
          return { result: "already-marked" };
        }
        marked.add(requestedId);
        return { result: "marked" };
      },
    ),
  };
}

async function fixture(state = "active") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [jwk] })),
  );
  const token = await new SignJWT({
    role: "authenticated",
    is_anonymous: false,
    app_metadata: { provider: "google" },
  })
    .setProtectedHeader({ alg: "ES256", kid: "delete-conversion" })
    .setSubject(subject)
    .setIssuer(`${url}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  const accounts = new Map([
    [accountId, createAccount(accountId, state, [conversionId])],
    [otherAccountId, createAccount(otherAccountId, "active", [otherAccountConversionId])],
  ]);
  const owners = new Map([
    [conversionId, { kind: "account", accountId }],
    [otherAccountConversionId, { kind: "account", accountId: otherAccountId }],
    [trialConversionId, { kind: "trial", grantId: crypto.randomUUID() }],
  ]);
  const env = {
    SUPABASE_URL: url,
    ACCOUNTS: { idFromName: (name: string) => name, get: (name: string) => accounts.get(name) },
    REGISTRY: {
      idFromName: (name: string) => name,
      get: () => ({
        findIdentity: async () => ({ accountId, subject, phase: "active" }),
        findConversionOwner: async (id: string) => owners.get(id),
      }),
    },
  };
  if (!isFixtureEnvironment(env)) {
    throw new Error("Missing account fixture bindings");
  }
  const app = createApiServer();
  const deleteConversion = (
    id: string,
    headers: Record<string, string> = { "X-Create-Audiobook-From-URL-Request": "1" },
  ) =>
    app.request(
      `https://cup.audio/api/account/conversions/${id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...headers,
        },
      },
      env,
    );
  return { deleteConversion, account: accounts.get(accountId) };
}

test("deleting an own conversion answers 204, also on a repeat", async () => {
  const { deleteConversion, account } = await fixture();

  for (const _ of [1, 2]) {
    const response = await deleteConversion(conversionId);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  }
  expect(account?.deleteConversion).toHaveBeenCalledTimes(2);
});

test("another account's, a trial and an unknown conversion are not found", async () => {
  const { deleteConversion } = await fixture();

  for (const id of [otherAccountConversionId, trialConversionId, crypto.randomUUID()]) {
    const response = await deleteConversion(id);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "audiobook-not-found" } });
  }
});

test("an account that is not active cannot delete a conversion", async () => {
  for (const state of ["deletion_scheduled", "deleting"]) {
    const { deleteConversion, account } = await fixture(state);

    const response = await deleteConversion(conversionId);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "account-blocked" } });
    expect(account?.deleteConversion).not.toHaveBeenCalled();
  }
});

test("a conversion deletion from another site is forbidden and an invalid ID is invalid input", async () => {
  const { deleteConversion, account } = await fixture();

  const response = await deleteConversion(conversionId, {
    "X-Create-Audiobook-From-URL-Request": "1",
    Origin: "https://attacker.example",
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "origin-forbidden" } });
  expect(account?.deleteConversion).not.toHaveBeenCalled();
  expect((await deleteConversion("not-a-uuid")).status).toBe(400);
});

function isFixtureEnvironment(value: unknown): value is ApiServerEnvironment {
  return typeof value === "object" && value !== null && "ACCOUNTS" in value && "REGISTRY" in value;
}
