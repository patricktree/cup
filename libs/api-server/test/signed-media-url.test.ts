import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Temporal } from "temporal-polyfill";
import { afterEach, expect, test, vi } from "vitest";

import { SPEECH_CONFIG } from "@cup/audiobook-production";
import { createConversionArtifactPrefix, type ConversionOwner } from "@cup/conversion-contracts";
import type { GrantState } from "@cup/conversion-grants/contracts";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { createApiServer } from "#src/api-server.ts";
import { signMediaUrl } from "#src/http/signed-media-url.ts";

vi.mock("@cup/conversion-grants", async () => ({
  ...(await import("@cup/conversion-grants/contracts")),
  ...(await import("@cup/conversion-grants/session")),
}));

const SIGNING_KEY = "test-media-url-signing-key";
const HOUR_MS = 60 * 60 * 1_000;
const conversionId = "f9cc2e59-46a3-4890-b923-bda04d03b4d0";
const accountId = "d1a52e64-3e4d-4a7f-a711-7fb11501e9af";
const grantId = "6b0f5f2e-8d7c-4b8e-9a51-0f7c3c2d1e4a";
const subject = "f355f913-ba12-45d6-a7d2-4df95f7cf11f";
const supabaseUrl = "https://access-test.supabase.co";
const origin = "https://cup.audio";
const audiobookPath = `/api/audiobooks/${conversionId}`;
const coverImagePath = `/api/files/audiobooks/${conversionId}/cover-image`;
const grantCookie = `__Secure-grant-session-${grantId}=valid-session`;
const accountOwner: ConversionOwner = { kind: "account", accountId };
const trialOwner: ConversionOwner = { kind: "trial", grantId };
const keys = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "signed-media-url" };

afterEach(() => vi.unstubAllGlobals());

function fixture(owner: ConversionOwner) {
  const artifactPrefix = createConversionArtifactPrefix(conversionId, owner);
  const manifest = JSON.stringify({
    title: "A document",
    originalUrl: "https://example.com/source",
    speechConfig: SPEECH_CONFIG,
    narrationDocument: {
      html: '<h1 id="synchronization-unit-1">A document</h1>',
      synchronizationUnits: [{ id: "synchronization-unit-1", narrationText: "A document" }],
    },
    coverImage: { contentType: "image/jpeg", byteLength: 3 },
  });
  const reference = {
    key: `${artifactPrefix}audiobook.json`,
    contentType: "application/json",
    byteLength: manifest.length,
    etag: "manifest-etag",
  };
  async function readBucket(key: string) {
    if (key === reference.key) {
      return {
        size: reference.byteLength,
        etag: reference.etag,
        httpMetadata: { contentType: reference.contentType },
        text: async () => manifest,
      };
    }
    if (key === `${artifactPrefix}cover-image`) {
      return { size: 3, httpEtag: '"cover-etag"', body: new Uint8Array([1, 2, 3]) };
    }
    return null;
  }
  const bucketRead = vi.fn<typeof readBucket>(readBucket);

  const accountState = { current: "active" };
  const account = {
    inspect: async () => ({
      accountId,
      subject,
      createdAtMs: 1,
      executionEpoch: 1,
      state: accountState.current,
      balance: { unit: "audio-millisecond", available: 1_800_000, reserved: 0 },
    }),
    getConversion: async () => ({
      status: "ready",
      sourceUrl: "https://example.com/source",
      outcome: { status: "ready", audiobookReference: reference },
    }),
    listAudioSegments: async () => [{ sequence: 0, state: "settled", actualMilliseconds: 1_000 }],
    getPlaybackPosition: async () => null,
  };

  const grantState: { current: GrantState } = { current: "open" };
  const grantSnapshot = async () => ({ state: grantState.current });
  const grant = {
    inspect: grantSnapshot,
    validateSession: async (token: string) =>
      token === "valid-session"
        ? { result: "valid" as const, snapshot: await grantSnapshot() }
        : { result: "invalid" as const },
    getConversion: async () => ({ status: "ready", sourceUrl: "https://example.com/source" }),
    getReadyAudiobookReference: async () => reference,
    listAudioSegments: async () => [{ sequence: 0, state: "settled", actualMilliseconds: 1_000 }],
  };

  const env = {
    SUPABASE_URL: supabaseUrl,
    MEDIA_URL_SIGNING_KEY: SIGNING_KEY,
    ACCOUNTS: { idFromName: (name: string) => name, get: () => account },
    CONVERSION_GRANTS: { idFromName: (name: string) => name, get: () => grant },
    REGISTRY: {
      idFromName: (name: string) => name,
      get: () => ({
        findIdentity: async () => ({ accountId, subject, phase: "active" }),
        findConversionOwner: async (id: string) => (id === conversionId ? owner : undefined),
      }),
    },
    AUDIO_BUCKET: { get: bucketRead },
  };
  if (!isFixtureEnvironment(env)) {
    throw new Error("Missing signed media URL fixture bindings");
  }
  return { app: createApiServer(), env, bucketRead, accountState, grantState };
}

async function createAccessToken() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [jwk] })),
  );
  return new SignJWT({ role: "authenticated", is_anonymous: false })
    .setProtectedHeader({ alg: "ES256", kid: "signed-media-url" })
    .setSubject(subject)
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

function signCoverImageUrl(
  principal: ConversionOwner,
  overrides: { conversionId?: string; issuedAtMs?: number; signingKey?: string } = {},
) {
  return signMediaUrl({
    url: origin + coverImagePath,
    conversionId: overrides.conversionId ?? conversionId,
    principal,
    signingKey: overrides.signingKey ?? SIGNING_KEY,
    issuedAtMs: overrides.issuedAtMs ?? Temporal.Now.instant().epochMilliseconds,
  });
}

test("the audiobook response's cover image URL serves every request kind without other credentials", async () => {
  for (const [owner, headers] of [
    [accountOwner, { Authorization: `Bearer ${await createAccessToken()}` }],
    [trialOwner, { Cookie: grantCookie }],
  ] as const) {
    const { app, env } = fixture(owner);
    const audiobook: unknown = await (
      await app.request(origin + audiobookPath, { headers }, env)
    ).json();
    const coverImageUrl = getCoverImageUrl(audiobook);
    expect(coverImageUrl.startsWith(`${origin + coverImagePath}?token=`)).toBe(true);

    for (const [method, requestHeaders, status, body] of [
      ["GET", {}, 200, [1, 2, 3]],
      ["HEAD", {}, 200, []],
      ["GET", { Range: "bytes=0-1" }, 200, [1, 2, 3]],
      ["GET", { "If-None-Match": '"cover-etag"' }, 304, []],
    ] as const) {
      const response = await app.request(coverImageUrl, { method, headers: requestHeaders }, env);
      expect(response.status).toBe(status);
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(body);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  }
});

test("missing, malformed, tampered, expired and other-audiobook tokens answer 401 without storage access", async () => {
  for (const owner of [accountOwner, trialOwner]) {
    const { app, env, bucketRead } = fixture(owner);
    const validUrl = new URL(await signCoverImageUrl(owner));
    const validToken = validUrl.searchParams.get("token") ?? "";
    const tamperedToken = validToken.slice(0, -2) + (validToken.endsWith("AA") ? "BB" : "AA");
    const otherAudiobookUrl = new URL(
      await signCoverImageUrl(owner, { conversionId: crypto.randomUUID() }),
    );

    for (const token of [
      undefined,
      "",
      "not-a-token",
      tamperedToken,
      new URL(
        await signCoverImageUrl(owner, {
          issuedAtMs: Temporal.Now.instant().epochMilliseconds - 25 * HOUR_MS,
        }),
      ).searchParams.get("token"),
      new URL(await signCoverImageUrl(owner, { signingKey: "rotated-key" })).searchParams.get(
        "token",
      ),
      otherAudiobookUrl.searchParams.get("token"),
    ]) {
      const url = new URL(origin + coverImagePath);
      if (token !== undefined && token !== null) {
        url.searchParams.set("token", token);
      }
      for (const method of ["GET", "HEAD"]) {
        const response = await app.request(url.href, { method }, env);
        expect(response.status).toBe(401);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
    }
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("a token issued within the last 24 hours is still accepted", async () => {
  const { app, env } = fixture(trialOwner);
  const url = await signCoverImageUrl(trialOwner, {
    issuedAtMs: Temporal.Now.instant().epochMilliseconds - 23 * HOUR_MS,
  });
  expect((await app.request(url, {}, env)).status).toBe(200);
});

test("an unexpired token stops authorizing once the account's deletion is scheduled", async () => {
  const { app, env, bucketRead, accountState } = fixture(accountOwner);
  const url = await signCoverImageUrl(accountOwner);
  expect((await app.request(url, {}, env)).status).toBe(200);
  bucketRead.mockClear();

  accountState.current = "deletion_scheduled";
  for (const [method, headers] of [
    ["GET", {}],
    ["HEAD", {}],
    ["GET", { Range: "bytes=0-1" }],
    ["GET", { "If-None-Match": '"cover-etag"' }],
  ] as const) {
    const response = await app.request(url, { method, headers }, env);
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }
  expect(bucketRead).not.toHaveBeenCalled();
});

test("an unexpired token stops authorizing once the grant expires or is revoked", async () => {
  for (const state of ["expired", "revoked"] as const) {
    const { app, env, bucketRead, grantState } = fixture(trialOwner);
    const url = await signCoverImageUrl(trialOwner);
    expect((await app.request(url, {}, env)).status).toBe(200);
    bucketRead.mockClear();

    grantState.current = state;
    for (const [method, headers] of [
      ["GET", {}],
      ["HEAD", {}],
      ["GET", { Range: "bytes=0-1" }],
      ["GET", { "If-None-Match": '"cover-etag"' }],
    ] as const) {
      const response = await app.request(url, { method, headers }, env);
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("a token for a principal that does not own the audiobook is denied as today's foreign request", async () => {
  for (const [owner, principal, expected] of [
    [accountOwner, { kind: "account", accountId: crypto.randomUUID() }, 404],
    [accountOwner, trialOwner, 404],
    [trialOwner, { kind: "trial", grantId: crypto.randomUUID() }, 401],
    [trialOwner, accountOwner, 401],
  ] as const) {
    const { app, env, bucketRead } = fixture(owner);
    const response = await app.request(await signCoverImageUrl(principal), {}, env);
    expect(response.status).toBe(expected);
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

function getCoverImageUrl(audiobook: unknown): string {
  if (
    typeof audiobook !== "object" ||
    audiobook === null ||
    !("coverImage" in audiobook) ||
    typeof audiobook.coverImage !== "object" ||
    audiobook.coverImage === null ||
    !("url" in audiobook.coverImage) ||
    typeof audiobook.coverImage.url !== "string"
  ) {
    throw new Error("The audiobook response has no cover image URL");
  }
  return audiobook.coverImage.url;
}

function isFixtureEnvironment(value: unknown): value is ApiServerEnvironment {
  return (
    typeof value === "object" &&
    value !== null &&
    "ACCOUNTS" in value &&
    "CONVERSION_GRANTS" in value &&
    "REGISTRY" in value &&
    "AUDIO_BUCKET" in value
  );
}
