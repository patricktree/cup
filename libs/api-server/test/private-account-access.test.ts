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
  if (!isFixtureEnvironment(env)) throw new Error("Missing account fixture bindings");
  return { app: createApiServer(), env, token, bucketRead };
}

test("anonymous range, HEAD and conditional requests cannot touch private storage", async () => {
  const { app, env, bucketRead } = await fixture();
  for (const [method, headers] of [
    ["GET", { Range: "bytes=0-10" }],
    ["HEAD", {}],
    ["GET", { "If-None-Match": "known" }],
  ] as const) {
    const response = await app.request(
      `https://cup-audio.com/api/files/audiobooks/${conversionId}/audio.mp3`,
      { method, headers },
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }
  expect(bucketRead).not.toHaveBeenCalled();
});

test("non-owners and blocked accounts cannot touch private storage", async () => {
  for (const [owner, state, expected] of [
    [crypto.randomUUID(), "active", 404],
    [accountId, "deletion_scheduled", 403],
  ] as const) {
    const { app, env, token, bucketRead } = await fixture(owner, state);
    const response = await app.request(
      `https://cup-audio.com/api/files/audiobooks/${conversionId}/book.epub`,
      { headers: { Cookie: `cup_media=${token}` } },
      env,
    );
    expect(response.status).toBe(expected);
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("media cookie is HttpOnly and never authorizes JSON account APIs", async () => {
  const { app, env, token } = await fixture();
  const response = await app.request(
    "https://cup-audio.com/api/files/session",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Create-Audiobook-From-URL-Request": "1",
      },
      body: "{}",
    },
    env,
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("Set-Cookie")).toContain("HttpOnly; SameSite=Strict");
  expect(response.headers.get("Set-Cookie")).toContain("Secure");
  expect(response.headers.get("Set-Cookie")).toContain("Path=/api/files;");
  const denied = await app.request(
    "https://cup-audio.com/api/account",
    { headers: { Cookie: `cup_media=${token}` } },
    env,
  );
  expect(denied.status).toBe(401);
  const accepted = await app.request(
    "https://cup-audio.com/api/account",
    { headers: { Authorization: `Bearer ${token}` } },
    env,
  );
  expect(accepted.status).toBe(200);
});

test("percent-encoded owner identifiers cannot bypass media authorization", async () => {
  const { app, env, bucketRead } = await fixture();
  for (const resource of ["", "/audio.mp3", "/captions.vtt", "/book.epub"]) {
    const response = await app.request(
      `https://cup-audio.com/api/${resource ? "files/audiobooks" : "audiobooks"}/%66${conversionId.slice(1)}${resource}`,
      {},
      env,
    );
    expect(response.status).toBe(401);
  }
  expect(bucketRead).not.toHaveBeenCalled();
});

test("media cookies do not authorize audiobook JSON or media-session creation", async () => {
  const { app, env, token, bucketRead } = await fixture();
  const audiobook = await app.request(
    `https://cup-audio.com/api/audiobooks/${conversionId}`,
    { headers: { Cookie: `cup_media=${token}` } },
    env,
  );
  expect(audiobook.status).toBe(401);
  const session = await app.request(
    "https://cup-audio.com/api/files/session",
    {
      method: "POST",
      headers: {
        Cookie: `cup_media=${token}`,
        "Content-Type": "application/json",
        "X-Create-Audiobook-From-URL-Request": "1",
      },
      body: "{}",
    },
    env,
  );
  expect(session.status).toBe(401);
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
