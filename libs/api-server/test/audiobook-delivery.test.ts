import { expect, test } from "vitest";

import type { Audiobook } from "@cup/audiobook-production";

import { createAudiobookCaptions } from "#src/serve-audiobook.ts";
import {
  getAudiobookEpub,
  type AudiobookEpubArtifact,
  type GetAudiobookEpubDependencies,
} from "#src/use-cases/get-audiobook-epub.ts";
import {
  loadReadyAudiobook,
  type LoadReadyAudiobookDependencies,
} from "#src/use-cases/load-ready-audiobook.ts";

const AUDIOBOOK: Audiobook = {
  title: "A document",
  originalUrl: "https://example.com/source",
  narrationDocument: {
    html: '<h1 id="synchronization-unit-1">A document</h1>',
    synchronizationUnits: [{ id: "synchronization-unit-1", narrationText: "A document" }],
  },
  audio: {
    key: "conversions/conversion-id/audiobook.mp3",
    contentType: "audio/mpeg",
    byteLength: 48_000,
    durationMilliseconds: 1_000,
    etag: "audio-etag",
  },
  synchronizationCues: [
    {
      synchronizationUnitId: "synchronization-unit-1",
      startMilliseconds: 0,
      endMilliseconds: 1_000,
    },
  ],
};

test("loads the canonical audiobook for a ready conversion", async () => {
  const calls: string[] = [];
  const dependencies: LoadReadyAudiobookDependencies = {
    findGrantIdForConversion: async (conversionId) => {
      calls.push(`find-grant:${conversionId}`);
      return "grant-id";
    },
    getReadyAudiobookReference: async (grantId, conversionId) => {
      calls.push(`get-reference:${grantId}:${conversionId}`);
      return {
        key: "conversions/conversion-id/audiobook.json",
        contentType: "application/json",
        byteLength: 1_000,
        etag: "manifest-etag",
      };
    },
    loadAudiobook: async (reference) => {
      calls.push(`load-audiobook:${reference.key}`);
      return AUDIOBOOK;
    },
  };

  await expect(loadReadyAudiobook("conversion-id", dependencies)).resolves.toBe(AUDIOBOOK);
  expect(calls).toEqual([
    "find-grant:conversion-id",
    "get-reference:grant-id:conversion-id",
    "load-audiobook:conversions/conversion-id/audiobook.json",
  ]);
});

test("does not load an audiobook for an unknown conversion", async () => {
  const dependencies: LoadReadyAudiobookDependencies = {
    findGrantIdForConversion: async () => undefined,
    getReadyAudiobookReference: async () => {
      throw new Error("getReadyAudiobookReference must not be called");
    },
    loadAudiobook: async () => {
      throw new Error("loadAudiobook must not be called");
    },
  };

  await expect(loadReadyAudiobook("conversion-id", dependencies)).resolves.toBeUndefined();
});

test("creates WebVTT captions from the synchronized narration", () => {
  expect(createAudiobookCaptions(AUDIOBOOK)).toBe(
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA document\n",
  );
});

test("returns an existing synchronized EPUB without rebuilding it", async () => {
  const epub = createEpubArtifact();
  const dependencies: GetAudiobookEpubDependencies = {
    getEpub: async () => epub,
    getArtifactMetadata: async () => {
      throw new Error("getArtifactMetadata must not be called");
    },
    exportEpub: async () => {
      throw new Error("exportEpub must not be called");
    },
  };

  await expect(getAudiobookEpub("conversion-id", AUDIOBOOK, dependencies)).resolves.toBe(epub);
});

test("builds a missing EPUB from the canonical audio and segment metadata", async () => {
  const epub = createEpubArtifact();
  let epubReads = 0;
  const exports: Parameters<GetAudiobookEpubDependencies["exportEpub"]>[0][] = [];
  const dependencies: GetAudiobookEpubDependencies = {
    getEpub: async () => (++epubReads === 1 ? undefined : epub),
    getArtifactMetadata: async (key) =>
      key.endsWith("audiobook.mp3")
        ? {
            key,
            size: 48_000,
            uploadedAt: "2026-08-29T09:00:00.000Z",
          }
        : {
            key,
            size: 48_000,
            uploadedAt: "2026-08-29T09:00:00.000Z",
            customMetadata: {
              "audio-duration-milliseconds": "1000",
              "audio-crc32": "1234abcd",
              "synthesis-provider": "google-ai-studio",
              "synthesis-model": "gemini-3.1-flash-tts-preview",
              "synthesis-voice": "Charon",
              "synthesis-policy-version": "3",
            },
          },
    exportEpub: async (input) => {
      exports.push(input);
    },
  };

  await expect(getAudiobookEpub("conversion-id", AUDIOBOOK, dependencies)).resolves.toBe(epub);
  expect(exports).toEqual([
    {
      conversionId: "conversion-id",
      audiobook: AUDIOBOOK,
      audioSegments: [
        {
          conversionId: "conversion-id",
          sequence: 0,
          key: "conversions/conversion-id/audio-segments/0.mp3",
          byteLength: 48_000,
          durationMilliseconds: 1_000,
          crc32: 0x1234_abcd,
          speechConfig: {
            provider: "google-ai-studio",
            model: "gemini-3.1-flash-tts-preview",
            voice: "Charon",
            policyVersion: "3",
          },
        },
      ],
      modifiedAt: "2026-08-29T09:00:00.000Z",
    },
  ]);
});

function createEpubArtifact(): AudiobookEpubArtifact {
  return {
    body: new ReadableStream<Uint8Array>(),
    size: 2_000,
    etag: '"epub-etag"',
  };
}
