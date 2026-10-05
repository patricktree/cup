import { createAudioSegmentKey, loadAudiobook, type Audiobook } from "@cup/audiobook-production";
import { createConversionArtifactPrefix } from "@cup/conversion-contracts";
import type { ConversionGrantDurableObject } from "@cup/conversion-grants";
import type { RegistryDurableObject } from "@cup/registry";
import type { ErrorResponse } from "@cup/web-app-api.routes";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { loadReadyAudiobook } from "#src/use-cases/load-ready-audiobook.ts";

type GrantStub = DurableObjectStub<ConversionGrantDurableObject>;
type RegistryStub = DurableObjectStub<RegistryDurableObject>;

export async function loadReadyAudiobookFromEnvironment(
  env: ApiServerEnvironment,
  conversionId: string,
): Promise<Audiobook | undefined> {
  const owner = await getRegistryStub(env).findConversionOwner(conversionId);
  if (owner?.kind === "account") {
    const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner.accountId));
    if ((await account.inspect()).state !== "active") return undefined;
    const conversion = await account.getConversion(conversionId);
    if (conversion?.outcome?.status !== "ready") return undefined;
    const prefix = createConversionArtifactPrefix(conversionId, owner);
    if (conversion.outcome.audiobookReference.key !== `${prefix}audiobook.json`)
      throw new Error("Private manifest ownership mismatch");
    const audiobook = await loadAudiobook({
      bucket: env.AUDIO_BUCKET,
      audiobookReference: conversion.outcome.audiobookReference,
    });
    return audiobook;
  }
  return loadReadyAudiobook(conversionId, {
    findGrantIdForConversion: (id) => getRegistryStub(env).findGrantIdForConversion(id),
    getReadyAudiobookReference: (grantId, id) =>
      getGrantStub(env, grantId).getReadyAudiobookReference(id),
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
  const audiobook = await loadReadyAudiobookFromEnvironment(env, conversionId);
  if (audiobook === undefined) return audiobookNotFound(requestId);

  if (!audiobook.narrationDocument.synchronizationUnits[sequence])
    return audiobookNotFound(requestId);
  const owner = await getRegistryStub(env).findConversionOwner(conversionId);
  if (!owner) return audiobookNotFound(requestId);
  const usage =
    owner.kind === "account"
      ? await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner.accountId)).listAudioSegments(
          conversionId,
        )
      : await getGrantStub(env, owner.grantId).listAudioSegments(conversionId);
  if (!usage.some((item) => item.sequence === sequence && item.state === "settled"))
    return audiobookNotFound(requestId);
  const key = createAudioSegmentKey(
    conversionId,
    sequence,
    createConversionArtifactPrefix(conversionId, owner),
  );
  const object = await env.AUDIO_BUCKET.get(key);
  if (object === null) return audiobookNotFound(requestId);

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": "audio/mpeg",
    ETag: object.httpEtag,
  });
  if (request.headers.get("If-None-Match") === object.httpEtag)
    return new Response(null, { status: 304, headers });

  const range = request.headers.get("Range");
  if (range === null) {
    headers.set("Content-Length", object.size.toString());
    return new Response(isHead ? null : object.body, { status: 200, headers });
  }

  const parsed = parseRange(range, object.size);
  if (parsed === undefined)
    return new Response(
      JSON.stringify(
        createErrorBody(
          requestId,
          "range-not-satisfiable",
          "The requested byte range is not satisfiable.",
        ),
      ),
      {
        status: 416,
        headers: { "Content-Type": "application/json", "Content-Range": `bytes */${object.size}` },
      },
    );

  const ranged = await env.AUDIO_BUCKET.get(key, {
    range: { offset: parsed.start, length: parsed.end - parsed.start + 1 },
  });
  if (ranged === null) return audiobookNotFound(requestId);

  headers.set("Content-Length", (parsed.end - parsed.start + 1).toString());
  headers.set("Content-Range", `bytes ${parsed.start}-${parsed.end}/${object.size}`);

  return new Response(isHead ? null : ranged.body, { status: 206, headers });
}

function getGrantStub(env: ApiServerEnvironment, grantId: string): GrantStub {
  return env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(grantId));
}

function getRegistryStub(env: ApiServerEnvironment): RegistryStub {
  return env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
}

function parseRange(value: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (match === null || (match[1] === "" && match[2] === "")) return undefined;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
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

function audiobookNotFound(requestId: string): Response {
  return Response.json(createErrorBody(requestId, "audiobook-not-found", "Audiobook not found."), {
    status: 404,
  });
}

function createErrorBody(requestId: string, code: string, message: string): ErrorResponse {
  return { error: { code, message, requestId } };
}
