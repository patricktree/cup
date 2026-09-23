import { afterEach, expect, test, vi } from "vitest";

import { assembleAudiobook } from "#src/assemble-audiobook.ts";
import {
  createAudioSegmentMetadata,
  createAudioSegmentReference,
} from "#src/audio-segment-storage.ts";
import { ELEVENLABS_SPEECH_CONFIG, GEMINI_SPEECH_CONFIG } from "#src/speech-synthesis-config.ts";

afterEach(() => vi.unstubAllGlobals());

test("assembly rejects mixed providers", async () => {
  await expect(assembleAudiobook(createAudiobookAssemblyOptions(true))).rejects.toThrow(
    "different synthesis identities",
  );
});

test("assembly accepts complete legacy Gemini audio", async () => {
  await expect(assembleAudiobook(createAudiobookAssemblyOptions(false))).resolves.toMatchObject({
    byteLength: 8,
    durationMilliseconds: 48,
  });
});

function createAudiobookAssemblyOptions(shouldMixProviders: boolean) {
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expectedLength: number) {
        super();
        if (expectedLength <= 0) throw new Error("Expected positive stream length");
      }
    },
  );
  const objects = [
    GEMINI_SPEECH_CONFIG,
    shouldMixProviders ? ELEVENLABS_SPEECH_CONFIG : GEMINI_SPEECH_CONFIG,
  ].map((speechConfig, sequence) => ({
    key: `conversions/conversion-id/audio-segments/${sequence}.mp3`,
    size: 4,
    httpMetadata: { contentType: "audio/mpeg" },
    customMetadata: createAudioSegmentMetadata("Narration", 24, 123, speechConfig),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    }),
  }));
  const bucket = {
    get: async (key: string) => objects.find((object) => object.key === key) ?? null,
    put: async (key: string, body: ReadableStream<Uint8Array>) => {
      const bytes = await new Response(body).arrayBuffer();
      return { key, size: bytes.byteLength, etag: "etag" };
    },
  };
  return {
    bucket,
    conversionId: "conversion-id",
    audioSegments: objects.map((object, sequence) =>
      createAudioSegmentReference(object, "conversion-id", sequence),
    ),
  };
}
