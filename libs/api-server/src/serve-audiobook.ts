import { accountArtifactBucket } from "@cup/accounts/artifact-writer";
import { exportEpub, loadAudiobook, type Audiobook } from "@cup/audiobook-production";
import { createConversionArtifactPrefix } from "@cup/conversion-contracts";
import type { ConversionGrantDurableObject } from "@cup/conversion-grants";
import type { RegistryDurableObject } from "@cup/registry";
import type { ErrorResponse } from "@cup/web-app-api.routes";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { getAudiobookEpub } from "#src/use-cases/get-audiobook-epub.ts";
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
    if (!audiobook.audio.key.startsWith(prefix))
      throw new Error("Private audio ownership mismatch");
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
  isHead: boolean,
  requestId: string,
): Promise<Response> {
  const audiobook = await loadReadyAudiobookFromEnvironment(env, conversionId);
  if (audiobook === undefined) return audiobookNotFound(requestId);

  const object = await env.AUDIO_BUCKET.get(audiobook.audio.key);
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

  const ranged = await env.AUDIO_BUCKET.get(audiobook.audio.key, {
    range: { offset: parsed.start, length: parsed.end - parsed.start + 1 },
  });
  if (ranged === null) return audiobookNotFound(requestId);

  headers.set("Content-Length", (parsed.end - parsed.start + 1).toString());
  headers.set("Content-Range", `bytes ${parsed.start}-${parsed.end}/${object.size}`);

  return new Response(isHead ? null : ranged.body, { status: 206, headers });
}

export async function serveCaptions(
  env: ApiServerEnvironment,
  conversionId: string,
  requestId: string,
): Promise<Response> {
  const audiobook = await loadReadyAudiobookFromEnvironment(env, conversionId);
  if (audiobook === undefined) return audiobookNotFound(requestId);

  return new Response(createAudiobookCaptions(audiobook), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/vtt; charset=utf-8",
      "Content-Disposition": 'inline; filename="captions.vtt"',
    },
  });
}

export function createAudiobookCaptions(audiobook: Audiobook): string {
  const cues = audiobook.synchronizationCues.flatMap((cue, sequence) => {
    const synchronizationUnit = audiobook.narrationDocument.synchronizationUnits[sequence]!;
    return [
      `${formatWebVttTimestamp(cue.startMilliseconds)} --> ${formatWebVttTimestamp(cue.endMilliseconds)}`,
      escapeWebVttText(synchronizationUnit.narrationText),
      "",
    ];
  });

  return ["WEBVTT", "", ...cues].join("\n");
}

export async function serveEpub(
  env: ApiServerEnvironment,
  request: Request,
  conversionId: string,
  isHead: boolean,
  requestId: string,
): Promise<Response> {
  const audiobook = await loadReadyAudiobookFromEnvironment(env, conversionId);
  if (audiobook === undefined) return audiobookNotFound(requestId);

  const object = await getAudiobookEpub(conversionId, audiobook, {
    getEpub: async (key) => {
      const epub = await env.AUDIO_BUCKET.get(key);
      return epub === null ? undefined : { body: epub.body, size: epub.size, etag: epub.httpEtag };
    },
    getArtifactMetadata: async (key) => {
      const artifact = await env.AUDIO_BUCKET.head(key);
      return artifact === null
        ? undefined
        : {
            key: artifact.key,
            size: artifact.size,
            uploadedAt: artifact.uploaded.toISOString(),
            ...(artifact.httpMetadata === undefined ? {} : { httpMetadata: artifact.httpMetadata }),
            ...(artifact.customMetadata === undefined
              ? {}
              : { customMetadata: artifact.customMetadata }),
          };
    },
    exportEpub: async (input) => {
      const owner = await getRegistryStub(env).findConversionOwner(conversionId);
      if (owner?.kind === "account") {
        const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner.accountId));
        const snapshot = await account.inspect();
        if (snapshot.state !== "active") throw new Error("Account export is fenced");
        await exportEpub({
          ...input,
          bucket: accountArtifactBucket(
            env.AUDIO_BUCKET,
            account,
            snapshot.executionEpoch,
            createConversionArtifactPrefix(conversionId, owner),
            "export",
          ),
        });
      } else await exportEpub({ bucket: env.AUDIO_BUCKET, ...input });
    },
  });
  if (object === undefined) return audiobookNotFound(requestId);

  const headers = new Headers({
    "Content-Type": "application/epub+zip",
    "Content-Length": object.size.toString(),
    ETag: object.etag,
    "Content-Disposition": 'attachment; filename="audiobook.epub"',
  });
  if (request.headers.get("If-None-Match") === object.etag)
    return new Response(null, { status: 304, headers });

  return new Response(isHead ? null : object.body, { status: 200, headers });
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

function formatWebVttTimestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainingMilliseconds = Math.floor(milliseconds % 1_000);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${remainingMilliseconds.toString().padStart(3, "0")}`;
}

function escapeWebVttText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function audiobookNotFound(requestId: string): Response {
  return Response.json(createErrorBody(requestId, "audiobook-not-found", "Audiobook not found."), {
    status: 404,
  });
}

function createErrorBody(requestId: string, code: string, message: string): ErrorResponse {
  return { error: { code, message, requestId } };
}
