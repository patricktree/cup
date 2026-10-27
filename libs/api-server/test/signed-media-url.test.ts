import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Temporal } from "temporal-polyfill";
import { afterEach, expect, test, vi } from "vitest";

import { SPEECH_CONFIG } from "@cup/audiobook-production";
import { createConversionArtifactPrefix, type ConversionOwner } from "@cup/conversion-contracts";
import type { GrantState } from "@cup/conversion-grants/contracts";
import { accountHistorySchema, audiobookSchema } from "@cup/listener-api.routes";

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
const historyPath = "/api/account/conversions";
const COVER_CACHE_CONTROL = "private, max-age=86400, immutable";
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
    listAudioSegments: async () => [{ sequence: 0, state: "settled", actualMilliseconds: 960 }],
    getPlaybackPosition: async () => null,
    history: async () => ({
      items: [
        {
          conversionId,
          idempotencyKey: conversionId,
          sourceUrl: "https://example.com/source",
          createdAtMs: 1,
          status: "ready",
          completedAtMs: 2,
          outcome: {
            status: "ready",
            title: "A document",
            audiobookReference: reference,
            hasCoverImage: true,
          },
        },
      ],
      nextCursor: null,
    }),
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
    listAudioSegments: async () => [{ sequence: 0, state: "settled", actualMilliseconds: 960 }],
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
  return { app: createApiServer(), env, bucketRead, readBucket, accountState, grantState };
}

async function createAccessToken() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [jwk] })),
  );
  return new SignJWT({
    role: "authenticated",
    is_anonymous: false,
    app_metadata: { provider: "google" },
  })
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
  overrides: { conversionId?: string; nowMs?: number; signingKey?: string } = {},
) {
  return signMediaUrl({
    url: origin + coverImagePath,
    conversionId: overrides.conversionId ?? conversionId,
    principal,
    signingKey: overrides.signingKey ?? SIGNING_KEY,
    nowMs: overrides.nowMs ?? Temporal.Now.instant().epochMilliseconds,
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
      expect(response.headers.get("Cache-Control")).toBe(COVER_CACHE_CONTROL);
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
          nowMs: Temporal.Now.instant().epochMilliseconds - 48 * HOUR_MS,
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

test("a token handed out within the last 24 hours is still accepted", async () => {
  const { app, env } = fixture(trialOwner);
  const url = await signCoverImageUrl(trialOwner, {
    nowMs: Temporal.Now.instant().epochMilliseconds - 24 * HOUR_MS + 60_000,
  });
  expect((await app.request(url, {}, env)).status).toBe(200);
});

test("a ready history item's cover URL serves the cover, cached for a day", async () => {
  const { app, env } = fixture(accountOwner);
  const history = await requestJson(app, env, historyPath, {
    Authorization: `Bearer ${await createAccessToken()}`,
  });
  const coverImageUrl = getHistoryCoverImageUrl(history);
  expect(coverImageUrl.startsWith(`${origin + coverImagePath}?token=`)).toBe(true);

  for (const method of ["GET", "HEAD"]) {
    const response = await app.request(coverImageUrl, { method }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(COVER_CACHE_CONTROL);
  }
});

test("a cover error keeps private, no-store", async () => {
  const { app, env, bucketRead, readBucket } = fixture(accountOwner);
  bucketRead.mockImplementation(async (key) =>
    key.endsWith("cover-image") ? null : readBucket(key),
  );
  const response = await app.request(await signCoverImageUrl(accountOwner), {}, env);
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

test("audiobook and history responses within one UTC day carry identical media URLs", async () => {
  const { app, env } = fixture(accountOwner);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const mediaUrlsAt = async (instant: string) => {
      vi.setSystemTime(Temporal.Instant.from(instant).epochMilliseconds);
      const headers = { Authorization: `Bearer ${await createAccessToken()}` };
      const audiobook = await requestJson(app, env, audiobookPath, headers);
      const history = await requestJson(app, env, historyPath, headers);
      return {
        coverImage: getCoverImageUrl(audiobook),
        narrationTrack: getNarrationTrackUrl(audiobook),
        historyCoverImage: getHistoryCoverImageUrl(history),
      };
    };

    const startOfDay = await mediaUrlsAt("2026-10-27T00:00:00.000Z");
    expect(startOfDay.historyCoverImage).toBe(startOfDay.coverImage);
    expect(await mediaUrlsAt("2026-10-27T23:59:59.999Z")).toEqual(startOfDay);
    const nextDay = await mediaUrlsAt("2026-10-28T00:00:00.000Z");
    expect(nextDay.coverImage).not.toBe(startOfDay.coverImage);
    expect(nextDay.narrationTrack).not.toBe(startOfDay.narrationTrack);
  } finally {
    vi.useRealTimers();
  }
});

test("a URL handed out at 23:59 UTC is accepted until 48 hours after the start of its UTC day", async () => {
  const { app, env } = fixture(accountOwner);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Temporal.Instant.from("2026-10-27T23:59:00.000Z").epochMilliseconds);
    const audiobook = await requestJson(app, env, audiobookPath, {
      Authorization: `Bearer ${await createAccessToken()}`,
    });

    for (const [instant, status] of [
      // 47 hours after the start of the UTC day it was handed out on.
      ["2026-10-28T23:00:00.000Z", 200],
      ["2026-10-28T23:59:59.999Z", 200],
      ["2026-10-29T00:00:00.000Z", 401],
    ] as const) {
      vi.setSystemTime(Temporal.Instant.from(instant).epochMilliseconds);
      for (const url of [getCoverImageUrl(audiobook), getNarrationTrackUrl(audiobook)]) {
        expect((await app.request(url, { method: "HEAD" }, env)).status).toBe(status);
      }
    }
  } finally {
    vi.useRealTimers();
  }
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
  const trackUrl = await signMediaUrl({
    url: `${origin}/api/files/audiobooks/${conversionId}/narration-track.mp3`,
    conversionId,
    principal: accountOwner,
    signingKey: SIGNING_KEY,
    nowMs: Temporal.Now.instant().epochMilliseconds,
  });
  for (const method of ["GET", "HEAD"]) {
    const response = await app.request(trackUrl, { method }, env);
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

test("a bearer token, the media cookie or the grant cookie without a token answers 401 without storage access", async () => {
  const accessToken = await createAccessToken();
  for (const [owner, headers] of [
    [accountOwner, { Authorization: `Bearer ${accessToken}` }],
    [accountOwner, { Cookie: `cup_media=${accessToken}` }],
    [trialOwner, { Cookie: grantCookie }],
  ] as const) {
    const { app, env, bucketRead } = fixture(owner);
    for (const method of ["GET", "HEAD"]) {
      const response = await app.request(origin + coverImagePath, { method, headers }, env);
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("the retired segment audio route and media session endpoints answer 404 and set no cookie", async () => {
  const accessToken = await createAccessToken();
  const { app, env, bucketRead } = fixture(accountOwner);
  const segmentAudioUrl = `${origin}/api/files/audiobooks/${conversionId}/segments/0/audio.mp3`;
  const signedSegmentAudioUrl = await signMediaUrl({
    url: segmentAudioUrl,
    conversionId,
    principal: accountOwner,
    signingKey: SIGNING_KEY,
    nowMs: Temporal.Now.instant().epochMilliseconds,
  });
  const sessionMutationHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Create-Audiobook-From-URL-Request": "1",
  };

  for (const [url, method, headers] of [
    [segmentAudioUrl, "GET", { Authorization: `Bearer ${accessToken}` }],
    [segmentAudioUrl, "HEAD", { Cookie: `cup_media=${accessToken}` }],
    [signedSegmentAudioUrl, "GET", {}],
    [signedSegmentAudioUrl, "HEAD", {}],
    [`${origin}/api/files/session`, "POST", sessionMutationHeaders],
    [`${origin}/api/files/session`, "DELETE", sessionMutationHeaders],
  ] as const) {
    const response = await app.request(url, { method, headers }, env);
    expect(response.status).toBe(404);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  }
  expect(bucketRead).not.toHaveBeenCalled();
});

async function requestJson(
  app: ReturnType<typeof createApiServer>,
  env: ApiServerEnvironment,
  path: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await app.request(origin + path, { headers }, env);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return response.json();
}

function getHistoryCoverImageUrl(history: unknown): string {
  const outcome = accountHistorySchema.parse(history).items[0]?.outcome;
  if (outcome?.status !== "ready" || outcome.coverImage === undefined) {
    throw new Error("The history item has no cover image URL");
  }
  return outcome.coverImage.url;
}

function getNarrationTrackUrl(audiobook: unknown): string {
  const parsed = audiobookSchema.parse(audiobook);
  if (!("narrationTrack" in parsed) || parsed.narrationTrack === undefined) {
    throw new Error("The audiobook response has no narration track URL");
  }
  return parsed.narrationTrack.url;
}

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
