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
const conversionId = "f9cc2e59-46a3-4890-b923-bda04d03b4d0";
const subject = "f355f913-ba12-45d6-a7d2-4df95f7cf11f";
const url = "https://access-test.supabase.co";
const keys = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "private-access" };

afterEach(() => vi.unstubAllGlobals());

async function fixture(owner = accountId, state = "active") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [jwk] })),
  );
  const token = await new SignJWT({ role: "authenticated", is_anonymous: false })
    .setProtectedHeader({ alg: "ES256", kid: "private-access" })
    .setSubject(subject)
    .setIssuer(`${url}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  const bucketRead = vi.fn<() => never>(() => {
    throw new Error("Unauthorized bucket access");
  });
  const account = {
    inspect: async () => ({
      accountId,
      subject,
      createdAtMs: 1,
      executionEpoch: 1,
      state,
      balance: { unit: "audio-millisecond", available: 1_800_000, reserved: 0 },
    }),
    history: async () => ({ items: [], nextCursor: null }),
  };
  const env = {
    SUPABASE_URL: url,
    ACCOUNTS: { idFromName: (name: string) => name, get: () => account },
    REGISTRY: {
      idFromName: (name: string) => name,
      get: () => ({
        findIdentity: async () => ({ accountId, subject, phase: "active" }),
        findConversionOwner: async (id: string) =>
          id === conversionId ? { kind: "account", accountId: owner } : undefined,
      }),
    },
    AUDIO_BUCKET: { get: bucketRead },
  };
  if (!isFixtureEnvironment(env)) {
    throw new Error("Missing account fixture bindings");
  }
  return { app: createApiServer(), env, token, bucketRead };
}

test("anonymous range, HEAD and conditional media requests cannot touch private storage", async () => {
  const { app, env, bucketRead } = await fixture();
  for (const [method, headers, resource] of [
    ["GET", { Range: "bytes=0-10" }, "narration-track.mp3"],
    ["HEAD", {}, "narration-track.mp3"],
    ["GET", { "If-None-Match": "known" }, "narration-track.mp3"],
    ["GET", {}, "cover-image"],
    ["HEAD", {}, "cover-image"],
  ] as const) {
    const response = await app.request(
      `https://cup.audio/api/files/audiobooks/${conversionId}/${resource}`,
      { method, headers },
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }
  expect(bucketRead).not.toHaveBeenCalled();
});

test("non-owners and blocked accounts cannot read the audiobook", async () => {
  for (const [owner, state, expected] of [
    [crypto.randomUUID(), "active", 404],
    [accountId, "deletion_scheduled", 403],
  ] as const) {
    const { app, env, token, bucketRead } = await fixture(owner, state);
    const response = await app.request(
      `https://cup.audio/api/audiobooks/${conversionId}`,
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(response.status).toBe(expected);
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("percent-encoded owner identifiers cannot bypass authorization", async () => {
  const { app, env, bucketRead } = await fixture();
  for (const resource of ["", "/narration-track.mp3", "/cover-image"]) {
    const response = await app.request(
      `https://cup.audio/api/${resource ? "files/audiobooks" : "audiobooks"}/%66${conversionId.slice(1)}${resource}`,
      {},
      env,
    );
    expect(response.status).toBe(401);
  }
  expect(bucketRead).not.toHaveBeenCalled();
});

function isFixtureEnvironment(value: unknown): value is ApiServerEnvironment {
  return (
    typeof value === "object" &&
    value !== null &&
    "ACCOUNTS" in value &&
    "REGISTRY" in value &&
    "AUDIO_BUCKET" in value
  );
}
