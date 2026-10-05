import { expect, test, vi } from "vitest";

import { SPEECH_CONFIG } from "@cup/audiobook-production";
import type { GrantState } from "@cup/conversion-grants/contracts";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { createApiServer } from "#src/api-server.ts";

vi.mock("@cup/conversion-grants", async () => ({
  ...(await import("@cup/conversion-grants/contracts")),
  ...(await import("@cup/conversion-grants/session")),
}));

const conversionId = "f9cc2e59-46a3-4890-b923-bda04d03b4d0";
const grantId = "d1a52e64-3e4d-4a7f-a711-7fb11501e9af";
const cookie = `__Secure-grant-session-${grantId}=valid-session`;
const origin = "https://cup-audio.com";
const audiobookPath = `/api/audiobooks/${conversionId}`;
const audioPath = `/api/files/audiobooks/${conversionId}/segments/0/audio.mp3`;

function fixture(state: GrantState = "open") {
  const manifest = JSON.stringify({
    title: "A document",
    originalUrl: "https://example.com/source",
    speechConfig: SPEECH_CONFIG,
    narrationDocument: {
      html: '<h1 id="synchronization-unit-1">A document</h1>',
      synchronizationUnits: [{ id: "synchronization-unit-1", narrationText: "A document" }],
    },
  });
  const reference = {
    key: `conversions/${conversionId}/audiobook.json`,
    contentType: "application/json",
    byteLength: manifest.length,
    etag: "manifest-etag",
  };
  async function readBucket(key: string, options?: { range: { offset: number; length: number } }) {
    if (key === reference.key)
      return {
        size: reference.byteLength,
        etag: reference.etag,
        httpMetadata: { contentType: reference.contentType },
        text: async () => manifest,
      };
    const bytes = new Uint8Array([1, 2, 3]);
    return {
      size: bytes.length,
      httpEtag: '"audio-etag"',
      body: options
        ? bytes.slice(options.range.offset, options.range.offset + options.range.length)
        : bytes,
    };
  }
  const bucketRead = vi.fn<typeof readBucket>(readBucket);
  async function validate(token: string) {
    return token === "valid-session"
      ? { result: "valid" as const, snapshot: { state } }
      : { result: "invalid" as const };
  }
  const validateSession = vi.fn<typeof validate>(validate);
  const grant = {
    validateSession,
    getConversion: async () => ({ status: "ready", sourceUrl: "https://example.com/source" }),
    getReadyAudiobookReference: async () => reference,
    listAudioSegments: async () => [{ sequence: 0, state: "settled", actualMilliseconds: 1_000 }],
  };
  const env = {
    SUPABASE_URL: "https://access-test.supabase.co",
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
  if (!isFixtureEnvironment(env)) throw new Error("Missing trial fixture bindings");
  return { app: createApiServer(), env, bucketRead, validateSession };
}

test("missing, invalid and foreign grant sessions cannot read trial text or audio", async () => {
  for (const session of [
    undefined,
    cookie.replace("valid-session", "invalid-session"),
    cookie.replace(grantId, crypto.randomUUID()),
  ]) {
    const { app, env, bucketRead } = fixture();
    for (const [path, method, headers] of [
      [audiobookPath, "GET", {}],
      [`${audiobookPath}/segments/0`, "GET", {}],
      [`${audiobookPath}/segments/0`, "POST", {}],
      [`${audiobookPath}/retry`, "POST", {}],
      [audioPath, "GET", {}],
      [audioPath, "HEAD", {}],
      [audioPath, "GET", { Range: "bytes=0-1" }],
      [audioPath, "GET", { "If-None-Match": '"audio-etag"' }],
      [audiobookPath.replace(conversionId, `%66${conversionId.slice(1)}`), "GET", {}],
    ] as const) {
      const response = await app.request(
        origin + path,
        { method, headers: { ...headers, ...(session ? { Cookie: session } : {}) } },
        env,
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("expiry and revocation block subsequent text and media requests before storage access", async () => {
  for (const state of ["expired", "revoked"] as const) {
    const { app, env, bucketRead, validateSession } = fixture();
    expect(
      (await app.request(origin + audiobookPath, { headers: { Cookie: cookie } }, env)).status,
    ).toBe(200);
    bucketRead.mockClear();
    validateSession.mockResolvedValue({ result: "valid", snapshot: { state } });
    for (const [path, method, headers] of [
      [audiobookPath, "GET", {}],
      [`${audiobookPath}/segments/0`, "GET", {}],
      [`${audiobookPath}/segments/0`, "POST", {}],
      [`${audiobookPath}/retry`, "POST", {}],
      [audioPath, "HEAD", {}],
      [audioPath, "GET", { Range: "bytes=0-1" }],
      [audioPath, "GET", { "If-None-Match": '"audio-etag"' }],
    ] as const) {
      const response = await app.request(
        origin + path,
        { method, headers: { ...headers, Cookie: cookie } },
        env,
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("owning grant sessions can read and replay with exhausted or fully reserved allowance", async () => {
  for (const state of ["open", "exhausted", "temporarily-full"] as const) {
    const { app, env } = fixture(state);
    const headers = { Cookie: cookie, Origin: "https://localhost" };
    const audiobook = await app.request(origin + audiobookPath, { headers }, env);
    expect(audiobook.status).toBe(200);
    expect(await audiobook.json()).toMatchObject({ status: "ready", title: "A document" });
    for (const [method, extraHeaders, status] of [
      ["GET", {}, 200],
      ["HEAD", {}, 200],
      ["GET", { Range: "bytes=0-1" }, 206],
      ["GET", { "If-None-Match": '"audio-etag"' }, 304],
    ] as const) {
      const response = await app.request(
        origin + audioPath,
        { method, headers: { ...headers, ...extraHeaders } },
        env,
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    }
  }
});

test("grant validation failures fail closed without reading storage", async () => {
  const { app, env, bucketRead, validateSession } = fixture();
  validateSession.mockRejectedValue(new Error("Grant unavailable"));
  const response = await app.request(origin + audioPath, { headers: { Cookie: cookie } }, env);
  expect(response.status).toBe(500);
  expect(bucketRead).not.toHaveBeenCalled();
});

test("trial delivery does not permit arbitrary cross-origin readers", async () => {
  const { app, env } = fixture();
  const response = await app.request(
    origin + audioPath,
    { headers: { Cookie: cookie, Origin: "https://other.example" } },
    env,
  );
  expect(response.status).toBe(200);
  expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
});

function isFixtureEnvironment(value: unknown): value is ApiServerEnvironment {
  return (
    typeof value === "object" &&
    value !== null &&
    "CONVERSION_GRANTS" in value &&
    "REGISTRY" in value &&
    "AUDIO_BUCKET" in value
  );
}
