import {
  createAudioSegmentKey,
  createCoverImageKey,
  getSegmentByteLength,
  loadAudiobook,
  type Audiobook,
} from "@cup/audiobook-production";
import { findNarrationTrackDurations } from "@cup/conversion-contracts";
import type { ErrorCode, ErrorResponse } from "@cup/listener-api.routes";
import type { RegistryDurableObject } from "@cup/registry";

import { resolveConversionReader, type ConversionReader } from "#src/adapters/conversion-reader.ts";
import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { jsonError } from "#src/http/http-errors.ts";
import { loadReadyAudiobook } from "#src/use-cases/load-ready-audiobook.ts";

type RegistryStub = DurableObjectStub<RegistryDurableObject>;

export async function loadReadyAudiobookFromEnvironment(
  env: ApiServerEnvironment,
  conversionId: string,
  reader?: ConversionReader,
): Promise<Audiobook | undefined> {
  if (!reader) {
    const owner = await getRegistryStub(env).findConversionOwner(conversionId);
    if (!owner) {
      return undefined;
    }
    reader = resolveConversionReader(env, conversionId, owner);
  }
  const conversionReader = reader;
  return loadReadyAudiobook({
    getReadyAudiobookReference: () => conversionReader.getReadyAudiobookReference(),
    loadAudiobook: (reference) =>
      loadAudiobook({ bucket: env.AUDIO_BUCKET, audiobookReference: reference }),
  });
}

export async function serveAudio(
  env: ApiServerEnvironment,
  request: Request,
  conversionId: string,
  sequence: number,
  isHead: boolean,
  requestId: string,
): Promise<Response> {
  const owner = await getRegistryStub(env).findConversionOwner(conversionId);
  if (!owner) {
    return audiobookNotFound(requestId);
  }
  const reader = resolveConversionReader(env, conversionId, owner);
  const audiobook = await loadReadyAudiobookFromEnvironment(env, conversionId, reader);
  if (audiobook === undefined) {
    return audiobookNotFound(requestId);
  }

  if (!audiobook.narrationDocument.synchronizationUnits[sequence]) {
    return audiobookNotFound(requestId);
  }
  const usage = await reader.listAudioSegments();
  if (!usage.some((item) => item.sequence === sequence && item.state === "settled")) {
    return audiobookNotFound(requestId);
  }
  const key = createAudioSegmentKey(conversionId, sequence, reader.artifactPrefix);
  const object = await env.AUDIO_BUCKET.get(key);
  if (object === null) {
    return audiobookNotFound(requestId);
  }

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": "audio/mpeg",
    ETag: object.httpEtag,
  });
  if (request.headers.get("If-None-Match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  const range = request.headers.get("Range");
  if (range === null) {
    headers.set("Content-Length", object.size.toString());
    return new Response(isHead ? null : object.body, { status: 200, headers });
  }

  const parsed = parseRange(range, object.size);
  if (parsed === undefined) {
    return rangeNotSatisfiable(requestId, object.size);
  }

  const ranged = await env.AUDIO_BUCKET.get(key, {
    range: { offset: parsed.start, length: parsed.end - parsed.start + 1 },
  });
  if (ranged === null) {
    return audiobookNotFound(requestId);
  }

  headers.set("Content-Length", (parsed.end - parsed.start + 1).toString());
  headers.set("Content-Range", `bytes ${parsed.start}-${parsed.end}/${object.size}`);

  return new Response(isHead ? null : ranged.body, { status: 206, headers });
}

/**
 * Serves the narration track: the stored audio segments, unchanged and joined in sequence order.
 * The layout comes from the owner's settled durations alone, so the manifest is never loaded and
 * HEAD and conditional requests read nothing from R2. Request authorization happens before.
 */
export async function serveNarrationTrack(
  env: ApiServerEnvironment,
  request: Request,
  conversionId: string,
  requestId: string,
): Promise<Response> {
  const owner = await getRegistryStub(env).findConversionOwner(conversionId);
  if (!owner) {
    return narrationTrackNotFound(requestId);
  }
  const reader = resolveConversionReader(env, conversionId, owner);
  if ((await reader.getReadyAudiobookReference()) === undefined) {
    return narrationTrackNotFound(requestId);
  }
  const durations = findNarrationTrackDurations(await reader.listAudioSegments());
  if (durations === undefined) {
    return narrationTrackNotFound(requestId);
  }

  const segments = layOutNarrationTrack(durations);
  const totalByteLength = segments.reduce((total, segment) => total + segment.byteLength, 0);
  const etag = await createNarrationTrackEtag(conversionId, durations);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": "audio/mpeg",
    ETag: etag,
  });
  if (matchesIfNoneMatch(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  // Hono answers HEAD with the first matching route, which is the GET route.
  if (request.method === "HEAD") {
    headers.set("Content-Length", totalByteLength.toString());
    return new Response(null, { status: 200, headers });
  }

  const range = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  // A stale `If-Range` asks for the whole current track instead of a range of another version.
  const isRangeRequest = range !== null && (ifRange === null || ifRange === etag);
  let served = { start: 0, end: totalByteLength - 1 };
  if (isRangeRequest) {
    const parsed = parseRange(range, totalByteLength);
    if (parsed === undefined) {
      return rangeNotSatisfiable(requestId, totalByteLength);
    }
    served = parsed;
  }

  const parts = selectTrackParts(segments, served);
  const readPart = (part: TrackPart) =>
    readTrackPart(env, conversionId, reader.artifactPrefix, part);
  // The first part is read before headers are sent, so a missing object yields an error status.
  const firstBody = await readPart(parts[0]!);
  if (firstBody === undefined) {
    return jsonError(requestId, "operational-error", "The narration track could not be read.", 500);
  }

  const servedByteLength = served.end - served.start + 1;
  headers.set("Content-Length", servedByteLength.toString());
  if (isRangeRequest) {
    headers.set("Content-Range", `bytes ${served.start}-${served.end}/${totalByteLength}`);
  }
  return new Response(
    toFixedLengthBody(createTrackStream(firstBody, parts.slice(1), readPart), servedByteLength),
    { status: isRangeRequest ? 206 : 200, headers },
  );
}

/** Serves the stored cover image of a prepared audiobook; request authorization happens before. */
export async function serveCoverImage(
  env: ApiServerEnvironment,
  request: Request,
  conversionId: string,
  isHead: boolean,
  requestId: string,
): Promise<Response> {
  const owner = await getRegistryStub(env).findConversionOwner(conversionId);
  if (!owner) {
    return coverImageNotFound(requestId);
  }
  const reader = resolveConversionReader(env, conversionId, owner);
  const audiobook = await loadReadyAudiobookFromEnvironment(env, conversionId, reader);
  // The manifest decides: an object left by an earlier preparation attempt is not served.
  if (audiobook?.coverImage === undefined) {
    return coverImageNotFound(requestId);
  }

  const key = createCoverImageKey(conversionId, reader.artifactPrefix);
  const object = await env.AUDIO_BUCKET.get(key);
  if (object === null) {
    return coverImageNotFound(requestId);
  }

  const headers = new Headers({
    "Content-Type": audiobook.coverImage.contentType,
    ETag: object.httpEtag,
  });
  if (request.headers.get("If-None-Match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", object.size.toString());
  return new Response(isHead ? null : object.body, { status: 200, headers });
}

function getRegistryStub(env: ApiServerEnvironment): RegistryStub {
  return env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
}

function parseRange(value: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (match === null || (match[1] === "" && match[2] === "")) {
    return undefined;
  }
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return undefined;
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Number(match[2]);
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start <= end &&
    start < size
    ? { start, end: Math.min(end, size - 1) }
    : undefined;
}

type TrackSegment = { sequence: number; trackOffset: number; byteLength: number };
/** The bytes of one segment object that a request serves. */
type TrackPart = { sequence: number; segmentByteLength: number; offset: number; length: number };

function layOutNarrationTrack(durations: readonly number[]): TrackSegment[] {
  let trackOffset = 0;
  return durations.map((durationMilliseconds, sequence) => {
    const segment = {
      sequence,
      trackOffset,
      byteLength: getSegmentByteLength(durationMilliseconds),
    };
    trackOffset += segment.byteLength;
    return segment;
  });
}

function selectTrackParts(
  segments: readonly TrackSegment[],
  served: { start: number; end: number },
): TrackPart[] {
  return segments
    .filter(
      (segment) =>
        segment.trackOffset <= served.end &&
        segment.trackOffset + segment.byteLength > served.start,
    )
    .map((segment) => {
      const offset = Math.max(served.start - segment.trackOffset, 0);
      const end = Math.min(served.end - segment.trackOffset, segment.byteLength - 1);
      return {
        sequence: segment.sequence,
        segmentByteLength: segment.byteLength,
        offset,
        length: end - offset + 1,
      };
    });
}

/**
 * Reads one part with a ranged R2 `get`. Returns `undefined`, after logging, when the object is
 * missing or its size differs from the length derived from its settled duration.
 */
async function readTrackPart(
  env: ApiServerEnvironment,
  conversionId: string,
  artifactPrefix: string,
  part: TrackPart,
): Promise<ReadableStream<Uint8Array> | undefined> {
  const object = await env.AUDIO_BUCKET.get(
    createAudioSegmentKey(conversionId, part.sequence, artifactPrefix),
    { range: { offset: part.offset, length: part.length } },
  );
  if (object?.size === part.segmentByteLength) {
    return object.body;
  }

  await object?.body.cancel();
  console.error(
    JSON.stringify({
      event: "narration-track-segment-mismatch",
      conversionId,
      sequence: part.sequence,
      expectedByteLength: part.segmentByteLength,
      storedByteLength: object?.size ?? null,
    }),
  );
  return undefined;
}

/**
 * Streams the first part, then reads each further part only once the client has consumed the
 * previous one, so a cancelled request stops reading from R2.
 */
function createTrackStream(
  firstBody: ReadableStream<Uint8Array>,
  remainingParts: readonly TrackPart[],
  readPart: (part: TrackPart) => Promise<ReadableStream<Uint8Array> | undefined>,
): ReadableStream<Uint8Array> {
  let current: ReadableStreamDefaultReader<Uint8Array> | undefined = firstBody.getReader();
  let nextPartIndex = 0;

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        while (current !== undefined) {
          const chunk = await current.read();
          if (!chunk.done) {
            controller.enqueue(chunk.value);
            return;
          }

          const nextPart = remainingParts[nextPartIndex];
          nextPartIndex += 1;
          if (nextPart === undefined) {
            current = undefined;
            controller.close();
            return;
          }
          const body = await readPart(nextPart);
          if (body === undefined) {
            current = undefined;
            throw new Error(`Narration track segment ${nextPart.sequence} could not be read`);
          }
          current = body.getReader();
        }
      },
      async cancel(reason) {
        await current?.cancel(reason);
        current = undefined;
      },
    },
    // Pull only when the client reads.
    { highWaterMark: 0 },
  );
}

/**
 * Workers send a generic stream chunked and ignore a `Content-Length` header set for it; a
 * `FixedLengthStream` body keeps the declared length. Node, which runs the unit tests, has no
 * `FixedLengthStream` and keeps the header as set.
 */
function toFixedLengthBody(
  body: ReadableStream<Uint8Array>,
  byteLength: number,
): ReadableStream<Uint8Array> {
  if (typeof FixedLengthStream === "undefined") {
    return body;
  }
  return body.pipeThrough(new FixedLengthStream(byteLength));
}

/** A strong ETag that changes with the conversion or any segment's settled duration. */
async function createNarrationTrackEtag(
  conversionId: string,
  durations: readonly number[],
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([conversionId, durations])),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `"${hex.join("")}"`;
}

/** `If-None-Match` uses the weak comparison and may list several tags or `*`. */
function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) {
    return false;
  }
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

function rangeNotSatisfiable(requestId: string, size: number): Response {
  return Response.json(
    createErrorBody(
      requestId,
      "range-not-satisfiable",
      "The requested byte range is not satisfiable.",
    ),
    { status: 416, headers: { "Content-Range": `bytes */${size}` } },
  );
}

function narrationTrackNotFound(requestId: string): Response {
  return Response.json(
    createErrorBody(requestId, "narration-track-not-found", "Narration track not found."),
    { status: 404 },
  );
}

function audiobookNotFound(requestId: string): Response {
  return Response.json(createErrorBody(requestId, "audiobook-not-found", "Audiobook not found."), {
    status: 404,
  });
}

function coverImageNotFound(requestId: string): Response {
  return Response.json(
    createErrorBody(requestId, "cover-image-not-found", "Cover image not found."),
    { status: 404 },
  );
}

function createErrorBody(requestId: string, code: ErrorCode, message: string): ErrorResponse {
  return { error: { code, message, requestId } };
}
