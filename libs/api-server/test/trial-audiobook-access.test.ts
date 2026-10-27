import { Temporal } from "temporal-polyfill";
import { expect, test, vi } from "vitest";

import { SPEECH_CONFIG } from "@cup/audiobook-production";
import type { GrantState } from "@cup/conversion-grants/contracts";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { createApiServer } from "#src/api-server.ts";
import { signMediaUrl } from "#src/http/signed-media-url.ts";

vi.mock("@cup/conversion-grants", async () => ({
  ...(await import("@cup/conversion-grants/contracts")),
  ...(await import("@cup/conversion-grants/session")),
}));

const SIGNING_KEY = "test-media-url-signing-key";
const conversionId = "f9cc2e59-46a3-4890-b923-bda04d03b4d0";
const grantId = "d1a52e64-3e4d-4a7f-a711-7fb11501e9af";
const cookie = `__Secure-grant-session-${grantId}=valid-session`;
const origin = "https://cup.audio";
const audiobookPath = `/api/audiobooks/${conversionId}`;
const coverImagePath = `/api/files/audiobooks/${conversionId}/cover-image`;
const coverImage = { contentType: "image/jpeg", byteLength: 3, alternativeText: "A lighthouse" };

function fixture(state: GrantState = "open", hasCoverImage = true) {
  const manifest = JSON.stringify({
    title: "A document",
    originalUrl: "https://example.com/source",
    speechConfig: SPEECH_CONFIG,
    narrationDocument: {
      html: '<h1 id="synchronization-unit-1">A document</h1>',
      synchronizationUnits: [{ id: "synchronization-unit-1", narrationText: "A document" }],
    },
    ...(hasCoverImage ? { coverImage } : {}),
  });
  const reference = {
    key: `conversions/${conversionId}/audiobook.json`,
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
    return { size: 3, httpEtag: '"cover-etag"', body: new Uint8Array([1, 2, 3]) };
  }
  const bucketRead = vi.fn<typeof readBucket>(readBucket);
  async function validate(token: string) {
    return token === "valid-session"
      ? { result: "valid" as const, snapshot: { state } }
      : { result: "invalid" as const };
  }
  const validateSession = vi.fn<typeof validate>(validate);
  const grant = {
    inspect: async () => ({ state }),
    validateSession,
    getConversion: async () => ({ status: "ready", sourceUrl: "https://example.com/source" }),
    getReadyAudiobookReference: async () => reference,
    listAudioSegments: async () => [{ sequence: 0, state: "settled", actualMilliseconds: 1_000 }],
  };
  const env = {
    SUPABASE_URL: "https://access-test.supabase.co",
    MEDIA_URL_SIGNING_KEY: SIGNING_KEY,
    CONVERSION_GRANTS: { idFromName: (name: string) => name, get: () => grant },
    REGISTRY: {
      idFromName: (name: string) => name,
      get: () => ({
        findConversionOwner: async () => ({ kind: "trial", grantId }),
        findGrantIdForConversion: async () => grantId,
      }),
    },
    AUDIO_BUCKET: { get: bucketRead },
  };
  if (!isFixtureEnvironment(env)) {
    throw new Error("Missing trial fixture bindings");
  }
  return { app: createApiServer(), env, bucketRead, validateSession };
}

function signCoverImageUrl() {
  return signMediaUrl({
    url: origin + coverImagePath,
    conversionId,
    principal: { kind: "trial", grantId },
    signingKey: SIGNING_KEY,
    nowMs: Temporal.Now.instant().epochMilliseconds,
  });
}

test("missing, invalid and foreign grant sessions cannot read trial text", async () => {
  for (const session of [
    undefined,
    cookie.replace("valid-session", "invalid-session"),
    cookie.replace(grantId, crypto.randomUUID()),
  ]) {
    const { app, env, bucketRead } = fixture();
    for (const [path, method] of [
      [audiobookPath, "GET"],
      [`${audiobookPath}/retry`, "POST"],
      [audiobookPath.replace(conversionId, `%66${conversionId.slice(1)}`), "GET"],
    ] as const) {
      const response = await app.request(
        origin + path,
        { method, headers: session ? { Cookie: session } : {} },
        env,
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("expiry and revocation block subsequent text requests before storage access", async () => {
  for (const state of ["expired", "revoked"] as const) {
    const { app, env, bucketRead, validateSession } = fixture();
    expect(
      (await app.request(origin + audiobookPath, { headers: { Cookie: cookie } }, env)).status,
    ).toBe(200);
    bucketRead.mockClear();
    validateSession.mockResolvedValue({ result: "valid", snapshot: { state } });
    for (const [path, method] of [
      [audiobookPath, "GET"],
      [`${audiobookPath}/retry`, "POST"],
    ] as const) {
      const response = await app.request(
        origin + path,
        { method, headers: { Cookie: cookie } },
        env,
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("owning grant sessions can read with exhausted or fully reserved allowance", async () => {
  for (const state of ["open", "exhausted", "temporarily-full"] as const) {
    const { app, env } = fixture(state);
    const audiobook = await app.request(
      origin + audiobookPath,
      { headers: { Cookie: cookie, Origin: "https://localhost" } },
      env,
    );
    expect(audiobook.status).toBe(200);
    expect(await audiobook.json()).toMatchObject({ status: "ready", title: "A document" });
    expect(audiobook.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
    expect(audiobook.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(audiobook.headers.get("Cache-Control")).toBe("private, no-store");
  }
});

test("owning grant sessions can read the cover image the audiobook points to", async () => {
  for (const state of ["open", "exhausted", "temporarily-full"] as const) {
    const { app, env } = fixture(state);
    const audiobook = await app.request(
      origin + audiobookPath,
      { headers: { Cookie: cookie, Origin: "https://localhost" } },
      env,
    );
    const body: unknown = await audiobook.json();
    expect(body).toMatchObject({
      coverImage: {
        url: expect.stringMatching(new RegExp(`^${origin + coverImagePath}\\?token=`)),
        alternativeText: "A lighthouse",
      },
    });
    for (const [method, extraHeaders, status, expectedBody] of [
      ["GET", {}, 200, [1, 2, 3]],
      ["HEAD", {}, 200, []],
      ["GET", { "If-None-Match": '"cover-etag"' }, 304, []],
    ] as const) {
      const response = await app.request(
        getCoverImageUrl(body),
        { method, headers: { Origin: "https://localhost", ...extraHeaders } },
        env,
      );
      expect(response.status).toBe(status);
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(expectedBody);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(response.headers.get("ETag")).toBe('"cover-etag"');
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
      expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400, immutable");
      expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    }
  }
});

test("an audiobook without a recorded cover image exposes none, whatever storage holds", async () => {
  const { app, env, bucketRead } = fixture("open", false);
  const audiobook = await app.request(origin + audiobookPath, { headers: { Cookie: cookie } }, env);
  expect(await audiobook.json()).not.toHaveProperty("coverImage");
  bucketRead.mockClear();

  const coverImageUrl = await signCoverImageUrl();
  for (const method of ["GET", "HEAD"]) {
    const response = await app.request(coverImageUrl, { method }, env);
    expect(response.status).toBe(404);
  }
  expect(bucketRead.mock.calls.map(([key]) => key)).toEqual([
    `conversions/${conversionId}/audiobook.json`,
    `conversions/${conversionId}/audiobook.json`,
  ]);
});

test("the cover image route accepts only reads", async () => {
  const { app, env } = fixture();
  const response = await app.request(await signCoverImageUrl(), { method: "POST" }, env);
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET, HEAD");
});

test("grant validation failures fail closed without reading storage", async () => {
  const { app, env, bucketRead, validateSession } = fixture();
  validateSession.mockRejectedValue(new Error("Grant unavailable"));
  const response = await app.request(origin + audiobookPath, { headers: { Cookie: cookie } }, env);
  expect(response.status).toBe(500);
  expect(bucketRead).not.toHaveBeenCalled();
});

test("trial media delivery does not permit arbitrary cross-origin readers", async () => {
  const { app, env } = fixture();
  const response = await app.request(
    await signCoverImageUrl(),
    { headers: { Origin: "https://other.example" } },
    env,
  );
  expect(response.status).toBe(200);
  expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
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
    "CONVERSION_GRANTS" in value &&
    "REGISTRY" in value &&
    "AUDIO_BUCKET" in value
  );
}
