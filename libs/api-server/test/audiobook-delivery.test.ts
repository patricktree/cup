import { expect, test } from "vitest";

import { SPEECH_CONFIG, type Audiobook } from "@cup/audiobook-production";

import {
  loadReadyAudiobook,
  type LoadReadyAudiobookDependencies,
} from "#src/use-cases/load-ready-audiobook.ts";
const AUDIOBOOK: Audiobook = {
  title: "A document",
  originalUrl: "https://example.com/source",
  speechConfig: SPEECH_CONFIG,
  narrationDocument: {
    html: '<h1 id="synchronization-unit-1">A document</h1>',
    synchronizationUnits: [{ id: "synchronization-unit-1", narrationText: "A document" }],
  },
};
test("loads the canonical audiobook for a ready conversion", async () => {
  const calls: string[] = [];
  const dependencies: LoadReadyAudiobookDependencies = {
    getReadyAudiobookReference: async () => {
      calls.push("get-reference");
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

  await expect(loadReadyAudiobook(dependencies)).resolves.toBe(AUDIOBOOK);
  expect(calls).toEqual([
    "get-reference",
    "load-audiobook:conversions/conversion-id/audiobook.json",
  ]);
});

test("does not read storage when the conversion has no accessible ready manifest", async () => {
  const dependencies: LoadReadyAudiobookDependencies = {
    getReadyAudiobookReference: async () => undefined,
    loadAudiobook: async () => {
      throw new Error("loadAudiobook must not be called");
    },
  };

  await expect(loadReadyAudiobook(dependencies)).resolves.toBeUndefined();
});
