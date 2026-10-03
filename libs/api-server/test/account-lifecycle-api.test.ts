import { beforeEach, expect, test, vi } from "vitest";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { createApiServer } from "#src/api-server.ts";

vi.mock("@cup/conversion-grants", async () => ({
  ...(await import("@cup/conversion-grants/contracts")),
  clearGrantSessionCookie: () => "",
  createGrantSessionCookie: () => "",
  createRootCredential: () => "",
  getGrantSessionCookie: () => undefined,
}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  revoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("#src/account-auth.ts", async (original) => ({
  ...(await original<typeof import("#src/account-auth.ts")>()),
  authenticateAccountRequest: mocks.authenticate,
}));
vi.mock("#src/google-token-revocation.ts", () => ({ revokeVerifiedGoogleToken: mocks.revoke }));

const challengeId = "d1a52e64-3e4d-4a7f-a711-7fb11501e9af";
const account = {
  deletionChallenge: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  scheduleDeletion: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  restoreAccount: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
};
const recordGoogleRevocation = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const env = {
  SUPABASE_URL: "https://auth.example.test",
  REGISTRY: { idFromName: (name: string) => name, get: () => ({ recordGoogleRevocation }) },
};
function isEnvironment(value: unknown): value is ApiServerEnvironment {
  return typeof value === "object" && value !== null && "REGISTRY" in value;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({
    result: "authenticated",
    identity: {
      email: "user@example.com",
      googleAuthenticated: true,
      authenticatedAtSeconds: 10,
      subject: challengeId,
    },
    snapshot: { state: "deletion_scheduled" },
    account,
  });
  account.scheduleDeletion.mockResolvedValue({
    result: "scheduled",
    attempt: { attemptId: challengeId, deadlineMs: 100 },
  });
  account.restoreAccount.mockResolvedValue({ result: "restored", account: { state: "active" } });
});

function request(path = "", body: unknown = { challengeId }, headers: Record<string, string> = {}) {
  if (!isEnvironment(env)) throw new Error("Invalid fixture");
  return createApiServer().request(
    `https://cup-audio.com/api/account/deletion${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Create-Audiobook-From-URL-Request": "1",
        ...headers,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

test("invalid confirmation uses the shared validation error envelope", async () => {
  const response = await request("", { challengeId: "invalid" });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "invalid-input", message: expect.any(String), requestId: expect.any(String) },
  });
  expect(account.scheduleDeletion).not.toHaveBeenCalled();
});

test.each([
  ["unauthorized", 401],
  ["blocked", 403],
  ["rate-limited", 429],
  ["unavailable", 503],
])("preserves %s authentication errors", async (result, status) => {
  mocks.authenticate.mockResolvedValue({ result });
  const response = await request();
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({
    error: { code: expect.any(String), requestId: expect.any(String) },
  });
});

test.each(["", "/restore"])(
  "distinguishes confirmation conflicts from operational failures for %s",
  async (path) => {
    const operation = path ? account.restoreAccount : account.scheduleDeletion;
    operation
      .mockResolvedValueOnce({ result: "conflict" })
      .mockRejectedValueOnce(new Error("Storage unavailable"));
    const rejected = await request(path);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: { code: "confirmation-unavailable" } });
    const failed = await request(path);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ error: { code: "operational-error" } });
  },
);

test("revocation recording failure does not report invalid confirmation after scheduling", async () => {
  mocks.revoke.mockResolvedValue(true);
  recordGoogleRevocation.mockRejectedValue(new Error("Registry unavailable"));
  const response = await request("", { challengeId, providerToken: "google-token" });
  expect(account.scheduleDeletion).toHaveBeenCalledOnce();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ error: { code: "operational-error" } });
});

test("provider revocation failure is recorded without failing deletion", async () => {
  mocks.revoke.mockRejectedValue(new Error("Google unavailable"));
  const response = await request("", { challengeId, providerToken: "google-token" });
  expect(response.status).toBe(200);
  expect(recordGoogleRevocation).toHaveBeenCalledWith(challengeId, challengeId, "failed");
});

test("scheduled accounts retain explicit recovery access", async () => {
  const response = await request("/restore");
  expect(response.status).toBe(200);
  expect(account.restoreAccount).toHaveBeenCalledWith(challengeId, 10);
});

test("lifecycle requests preserve the native origin exception and reject other origins", async () => {
  expect((await request("", { challengeId }, { Origin: "https://localhost" })).status).toBe(200);
  expect((await request("", { challengeId }, { Origin: "https://example.com" })).status).toBe(403);
});
