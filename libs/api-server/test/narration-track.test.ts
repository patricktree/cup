import { Temporal } from "temporal-polyfill";
import { afterEach, expect, test, vi } from "vitest";

import { createAudioSegmentKey, SPEECH_CONFIG } from "@cup/audiobook-production";
import {
  createConversionArtifactPrefix,
  type ConversionOwner,
  type SegmentUsage,
} from "@cup/conversion-contracts";
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
const accountId = "d1a52e64-3e4d-4a7f-a711-7fb11501e9af";
const grantId = "6b0f5f2e-8d7c-4b8e-9a51-0f7c3c2d1e4a";
const origin = "https://cup.audio";
const trackPath = `/api/files/audiobooks/${conversionId}/narration-track.mp3`;
const trialOwner: ConversionOwner = { kind: "trial", grantId };
const accountOwner: ConversionOwner = { kind: "account", accountId };
// Byte lengths 768, 1,152 and 384 (16 bytes per millisecond): 2,304 bytes in total.
const SETTLED_DURATIONS = [48, 72, 24];

afterEach(() => vi.restoreAllMocks());

type SegmentRow = Pick<SegmentUsage, "sequence" | "state" | "actualMilliseconds">;

function fixture({
  owner = trialOwner,
  segments = SETTLED_DURATIONS.map((actualMilliseconds, sequence): SegmentRow => ({
    sequence,
    state: "settled",
    actualMilliseconds,
  })),
}: { owner?: ConversionOwner; segments?: SegmentRow[] } = {}) {
  const artifactPrefix = createConversionArtifactPrefix(conversionId, owner);
  const manifest = JSON.stringify({
    title: "A document",
    originalUrl: "https://example.com/source",
    speechConfig: SPEECH_CONFIG,
    narrationDocument: {
      html: segments.map((segment) => `<p id="unit-${segment.sequence}">Text</p>`).join(""),
      synchronizationUnits: segments.map((segment) => ({
        id: `unit-${segment.sequence}`,
        narrationText: "Text",
      })),
    },
  });
  const reference = {
    key: `${artifactPrefix}audiobook.json`,
    contentType: "application/json",
    byteLength: manifest.length,
    etag: "manifest-etag",
  };
  const storedSegments = new Map<string, Uint8Array>(
    segments.map((segment) => [
      createAudioSegmentKey(conversionId, segment.sequence, artifactPrefix),
      createSegmentBytes(segment.sequence, segment.actualMilliseconds * 16),
    ]),
  );

  async function readBucket(key: string, options?: { range?: { offset: number; length: number } }) {
    if (key === reference.key) {
      return {
        size: reference.byteLength,
        etag: reference.etag,
        httpMetadata: { contentType: reference.contentType },
        text: async () => manifest,
      };
    }
    const stored = storedSegments.get(key);
    if (stored === undefined) {
      return null;
    }
    const offset = options?.range?.offset ?? 0;
    const length = options?.range?.length ?? stored.byteLength - offset;
    return {
      size: stored.byteLength,
      httpEtag: `"segment-etag"`,
      body: new Response(stored.slice(offset, offset + length)).body,
    };
  }
  const bucketRead = vi.fn<typeof readBucket>(readBucket);

  const grantState: { current: GrantState } = { current: "open" };
  const grant = {
    inspect: async () => ({ state: grantState.current }),
    validateSession: async (token: string) =>
      token === "valid-session"
        ? { result: "valid" as const, snapshot: { state: grantState.current } }
        : { result: "invalid" as const },
    getConversion: async () => ({ status: "ready", sourceUrl: "https://example.com/source" }),
    getReadyAudiobookReference: async () => reference,
    listAudioSegments: async () => segments,
  };
  const account = {
    inspect: async () => ({ accountId, state: "active" }),
    getConversion: async () => ({
      status: "ready",
      sourceUrl: "https://example.com/source",
      outcome: { status: "ready", audiobookReference: reference },
    }),
    listAudioSegments: async () => segments,
  };

  const env = {
    SUPABASE_URL: "https://access-test.supabase.co",
    MEDIA_URL_SIGNING_KEY: SIGNING_KEY,
    ACCOUNTS: { idFromName: (name: string) => name, get: () => account },
    CONVERSION_GRANTS: { idFromName: (name: string) => name, get: () => grant },
    REGISTRY: {
      idFromName: (name: string) => name,
      get: () => ({
        findConversionOwner: async (id: string) => (id === conversionId ? owner : undefined),
      }),
    },
    AUDIO_BUCKET: { get: bucketRead },
  };
  if (!isFixtureEnvironment(env)) {
    throw new Error("Missing narration track fixture bindings");
  }
  return {
    app: createApiServer(),
    env,
    bucketRead,
    grantState,
    storedSegments,
    trackBytes: concatenate([...storedSegments.values()]),
  };
}

function signTrackUrl(principal: ConversionOwner = trialOwner) {
  return signMediaUrl({
    url: origin + trackPath,
    conversionId,
    principal,
    signingKey: SIGNING_KEY,
    nowMs: Temporal.Now.instant().epochMilliseconds,
  });
}

test("serves the stored segments joined in sequence order", async () => {
  const { app, env, trackBytes } = fixture();

  const response = await app.request(await signTrackUrl(), {}, env);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
  expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  expect(response.headers.get("Content-Length")).toBe("2304");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(trackBytes);
});

test.each([
  ["inside one segment", "bytes=100-199", 100, 199],
  ["across one segment boundary", "bytes=700-1000", 700, 1000],
  ["across two segment boundaries", "bytes=700-2000", 700, 2000],
  ["across three segment boundaries from the first byte", "bytes=0-2303", 0, 2303],
  ["of a suffix", "bytes=-500", 1804, 2303],
  ["open-ended from a later segment", "bytes=1920-", 1920, 2303],
  ["with an end beyond the track, clamped", "bytes=2000-99999", 2000, 2303],
])("serves a range %s", async (_, range, start, end) => {
  const { app, env, trackBytes } = fixture();

  const response = await app.request(await signTrackUrl(), { headers: { Range: range } }, env);

  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe(`bytes ${start}-${end}/2304`);
  expect(response.headers.get("Content-Length")).toBe(String(end - start + 1));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(trackBytes.slice(start, end + 1));
});

test("reads each touched segment once with a ranged read, and no other object", async () => {
  const { app, env, bucketRead } = fixture();

  const response = await app.request(
    await signTrackUrl(),
    { headers: { Range: "bytes=700-2000" } },
    env,
  );
  await response.arrayBuffer();

  expect(bucketRead.mock.calls.map(([key, options]) => [key.split("/").at(-1), options])).toEqual([
    ["0.mp3", { range: { offset: 700, length: 68 } }],
    ["1.mp3", { range: { offset: 0, length: 1_152 } }],
    ["2.mp3", { range: { offset: 0, length: 81 } }],
  ]);
});

test("reads a later segment only once the client has consumed the earlier ones", async () => {
  const { app, env, bucketRead } = fixture();

  const response = await app.request(await signTrackUrl(), {}, env);
  expect(bucketRead).toHaveBeenCalledTimes(1);

  await response.body?.cancel();
  expect(bucketRead).toHaveBeenCalledTimes(1);
});

test.each(["bytes=2304-", "bytes=10-5", "bytes=-0", "bytes=0-1,5-6", "items=0-1", "bytes=-"])(
  "answers 416 for the malformed or unsatisfiable range %s",
  async (range) => {
    const { app, env, bucketRead } = fixture();

    const response = await app.request(await signTrackUrl(), { headers: { Range: range } }, env);

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */2304");
    expect(await response.json()).toMatchObject({ error: { code: "range-not-satisfiable" } });
    expect(bucketRead).not.toHaveBeenCalled();
  },
);

test("HEAD returns the total length and the ETag without reading R2", async () => {
  const { app, env, bucketRead } = fixture();

  const response = await app.request(await signTrackUrl(), { method: "HEAD" }, env);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Length")).toBe("2304");
  expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  expect(response.headers.get("ETag")).toMatch(/^"[0-9a-f]+"$/);
  expect(bucketRead).not.toHaveBeenCalled();
});

test("a matching If-None-Match answers 304 without reading R2", async () => {
  const { app, env, bucketRead } = fixture();
  const url = await signTrackUrl();
  const etag = (await app.request(url, { method: "HEAD" }, env)).headers.get("ETag") ?? "";

  for (const ifNoneMatch of [etag, `"other", ${etag}`, `W/${etag}`, "*"]) {
    const response = await app.request(url, { headers: { "If-None-Match": ifNoneMatch } }, env);
    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe(etag);
  }
  expect(bucketRead).not.toHaveBeenCalled();

  const stale = await app.request(url, { headers: { "If-None-Match": '"other"' } }, env);
  expect(stale.status).toBe(200);
});

test("the ETag changes when a segment's settled duration changes", async () => {
  const first = fixture();
  const second = fixture({
    segments: [
      { sequence: 0, state: "settled", actualMilliseconds: 48 },
      { sequence: 1, state: "settled", actualMilliseconds: 96 },
    ],
  });
  const url = await signTrackUrl();

  const firstEtag = (await first.app.request(url, { method: "HEAD" }, first.env)).headers.get(
    "ETag",
  );
  const secondEtag = (await second.app.request(url, { method: "HEAD" }, second.env)).headers.get(
    "ETag",
  );

  expect(firstEtag).not.toBe(secondEtag);
});

test("If-Range serves the range when it matches and the whole track when it is stale", async () => {
  const { app, env, trackBytes } = fixture();
  const url = await signTrackUrl();
  const etag = (await app.request(url, { method: "HEAD" }, env)).headers.get("ETag") ?? "";

  const matching = await app.request(
    url,
    { headers: { Range: "bytes=0-9", "If-Range": etag } },
    env,
  );
  expect(matching.status).toBe(206);
  expect(new Uint8Array(await matching.arrayBuffer())).toEqual(trackBytes.slice(0, 10));

  const stale = await app.request(
    url,
    { headers: { Range: "bytes=0-9", "If-Range": '"stale"' } },
    env,
  );
  expect(stale.status).toBe(200);
  expect(stale.headers.get("Content-Range")).toBeNull();
  expect(new Uint8Array(await stale.arrayBuffer())).toEqual(trackBytes);
});

test("a first touched segment whose size differs from its settled duration fails with 500 and is logged", async () => {
  const { app, env, storedSegments } = fixture();
  const [firstKey] = storedSegments.keys();
  storedSegments.set(firstKey!, new Uint8Array(770));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await app.request(await signTrackUrl(), {}, env);

  expect(response.status).toBe(500);
  expect(log).toHaveBeenCalledWith(
    JSON.stringify({
      event: "narration-track-segment-mismatch",
      conversionId,
      sequence: 0,
      expectedByteLength: 768,
      storedByteLength: 770,
    }),
  );
});

test("a later segment whose size differs or which is missing errors the stream and is logged", async () => {
  for (const replace of ["mismatch", "missing"] as const) {
    const { app, env, storedSegments } = fixture();
    const lastKey = [...storedSegments.keys()].at(-1)!;
    if (replace === "mismatch") {
      storedSegments.set(lastKey, new Uint8Array(100));
    } else {
      storedSegments.delete(lastKey);
    }
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await app.request(await signTrackUrl(), {}, env);

    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow(
      "Narration track segment 2 could not be read",
    );
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "narration-track-segment-mismatch",
        conversionId,
        sequence: 2,
        expectedByteLength: 384,
        storedByteLength: replace === "mismatch" ? 100 : null,
      }),
    );
    log.mockRestore();
  }
});

test.each([
  ["a reserved segment", "reserved"],
  ["a failed segment", "released"],
] as const)("answers 404 narration-track-not-found while there is %s", async (_, state) => {
  const { app, env, bucketRead } = fixture({
    segments: [
      { sequence: 0, state: "settled", actualMilliseconds: 48 },
      { sequence: 1, state, actualMilliseconds: 0 },
    ],
  });

  const url = await signTrackUrl();
  const response = await app.request(url, {}, env);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: "narration-track-not-found" } });
  expect((await app.request(url, { method: "HEAD" }, env)).status).toBe(404);
  expect(bucketRead).not.toHaveBeenCalled();
});

test("an account's narration track is served through a token for the owning account", async () => {
  const { app, env, trackBytes } = fixture({ owner: accountOwner });

  const response = await app.request(await signTrackUrl(accountOwner), {}, env);

  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(trackBytes);
});

test("answers 401 without a token, even with the grant cookie", async () => {
  const { app, env, bucketRead } = fixture();

  for (const method of ["GET", "HEAD"]) {
    const response = await app.request(
      origin + trackPath,
      { method, headers: { Cookie: `__Secure-grant-session-${grantId}=valid-session` } },
      env,
    );
    expect(response.status).toBe(401);
  }
  expect(bucketRead).not.toHaveBeenCalled();
});

test("answers 401 for tampered, expired and other-audiobook tokens", async () => {
  const { app, env, bucketRead } = fixture();
  const validToken = new URL(await signTrackUrl()).searchParams.get("token") ?? "";
  const otherAudiobookToken = new URL(
    await signMediaUrl({
      url: origin + trackPath,
      conversionId: crypto.randomUUID(),
      principal: trialOwner,
      signingKey: SIGNING_KEY,
      nowMs: Temporal.Now.instant().epochMilliseconds,
    }),
  ).searchParams.get("token");
  const expiredToken = new URL(
    await signMediaUrl({
      url: origin + trackPath,
      conversionId,
      principal: trialOwner,
      signingKey: SIGNING_KEY,
      nowMs: Temporal.Now.instant().epochMilliseconds - 48 * 60 * 60 * 1_000,
    }),
  ).searchParams.get("token");

  for (const token of [`${validToken}x`, expiredToken, otherAudiobookToken]) {
    const url = new URL(origin + trackPath);
    url.searchParams.set("token", token ?? "");
    const response = await app.request(url.href, {}, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "media-url-invalid" } });
  }
  expect(bucketRead).not.toHaveBeenCalled();
});

test("an unexpired token stops authorizing once the grant expires or is revoked", async () => {
  for (const state of ["expired", "revoked"] as const) {
    const { app, env, bucketRead, grantState } = fixture();
    const url = await signTrackUrl();
    grantState.current = state;

    for (const method of ["GET", "HEAD"]) {
      expect((await app.request(url, { method }, env)).status).toBe(403);
    }
    expect(bucketRead).not.toHaveBeenCalled();
  }
});

test("the audiobook response's narration track gives the start of every segment and serves the track", async () => {
  const { app, env, trackBytes } = fixture();

  const audiobook = await requestAudiobook(app, env);

  expect(audiobook["narrationTrack"]).toEqual({
    url: expect.stringMatching(new RegExp(`^${origin}${trackPath}\\?token=v1\\.`)),
    durationMilliseconds: 144,
    startMilliseconds: [0, 48, 120],
  });
  const response = await app.request(getNarrationTrackUrl(audiobook), {}, env);
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(trackBytes);
});

test.each([
  ["a reserved segment", "reserved"],
  ["a failed segment", "released"],
] as const)("the audiobook response has no narration track while there is %s", async (_, state) => {
  const { app, env } = fixture({
    segments: [
      { sequence: 0, state: "settled", actualMilliseconds: 48 },
      { sequence: 1, state, actualMilliseconds: 0 },
    ],
  });

  const audiobook = await requestAudiobook(app, env);

  expect(audiobook).not.toHaveProperty("narrationTrack");
});

async function requestAudiobook(
  app: ReturnType<typeof createApiServer>,
  env: ApiServerEnvironment,
): Promise<Record<string, unknown>> {
  const response = await app.request(
    `${origin}/api/audiobooks/${conversionId}`,
    { headers: { Cookie: `__Secure-grant-session-${grantId}=valid-session` } },
    env,
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) {
    throw new Error("The audiobook response is not an object");
  }
  return { ...body };
}

function getNarrationTrackUrl(audiobook: Record<string, unknown>): string {
  const narrationTrack = audiobook["narrationTrack"];
  if (
    typeof narrationTrack !== "object" ||
    narrationTrack === null ||
    !("url" in narrationTrack) ||
    typeof narrationTrack.url !== "string"
  ) {
    throw new Error("The audiobook response has no narration track URL");
  }
  return narrationTrack.url;
}

/** Bytes that differ per segment and per position, so a misplaced byte fails the comparison. */
function createSegmentBytes(sequence: number, byteLength: number): Uint8Array {
  return Uint8Array.from({ length: byteLength }, (_, index) => (sequence * 89 + index) % 256);
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
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
