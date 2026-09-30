import { afterEach, expect, test, vi } from "vitest";

import { assembleAudiobook } from "#src/assemble-audiobook.ts";
import {
  createAudioSegmentMetadata,
  createAudioSegmentReference,
} from "#src/audio-segment-storage.ts";
import {
  ELEVENLABS_SPEECH_CONFIG,
  GEMINI_SPEECH_CONFIG,
  LEGACY_GEMINI_SPEECH_CONFIG,
  type SpeechConfig,
} from "#src/speech-synthesis-config.ts";

afterEach(() => vi.unstubAllGlobals());

test.each([
  { identity: "providers", configs: [GEMINI_SPEECH_CONFIG, ELEVENLABS_SPEECH_CONFIG] },
  { identity: "Gemini models", configs: [LEGACY_GEMINI_SPEECH_CONFIG, GEMINI_SPEECH_CONFIG] },
])("assembly rejects mixed $identity", async ({ configs }) => {
  await expect(assembleAudiobook(createAudiobookAssemblyOptions(configs))).rejects.toThrow(
    "different synthesis identities",
  );
});

test.each([LEGACY_GEMINI_SPEECH_CONFIG, GEMINI_SPEECH_CONFIG])(
  "assembly accepts complete $model audio",
  async (speechConfig) => {
    await expect(
      assembleAudiobook(createAudiobookAssemblyOptions([speechConfig, speechConfig])),
    ).resolves.toMatchObject({
      byteLength: 8,
      durationMilliseconds: 48,
    });
  },
);

function createAudiobookAssemblyOptions(speechConfigs: readonly SpeechConfig[]) {
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expectedLength: number) {
        super();
        if (expectedLength <= 0) throw new Error("Expected positive stream length");
      }
    },
  );
  const objects = speechConfigs.map((speechConfig, sequence) => ({
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
