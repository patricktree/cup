import { expect, test, vi } from "vitest";

import {
  assertStoredAudioSegment,
  createAudioSegmentMetadata,
  createAudioSegmentReference,
  type StoredAudioSegment,
} from "#src/audio-segment-storage.ts";
import { produceAudioSegment, type ProduceOptions } from "#src/produce-audio-segment.ts";
import { createFakeSpeechSynthesisAi } from "#src/speech-synthesis-ai.fake.ts";
import { ELEVENLABS_SPEECH_CONFIG, GEMINI_SPEECH_CONFIG } from "#src/speech-synthesis-config.ts";
import { PermanentNarrationSynthesisError, type SynthesisOptions } from "#src/speech-synthesis.ts";
import { synthesizeElevenLabsAudio } from "#src/synthesize-elevenlabs-audio.ts";

const REQUEST = {
  conversionId: "conversion-id",
  narrationText: "Read exactly this: Grüß Gott, Cloudflare!",
  sequence: 2,
  synthesisAttempt: 1,
  synthesisResponseMode: "streaming",
  speechConfig: ELEVENLABS_SPEECH_CONFIG,
} as const;

test.each(["streaming", "non-streaming"] as const)(
  "requests unchanged text and 24 kHz PCM through the gateway in %s mode",
  async (synthesisResponseMode) => {
    const pcm = new Uint8Array([0, 0, 1, 0]);
    const run = vi
      .fn<ReturnType<SynthesisOptions["ai"]["gateway"]>["run"]>()
      .mockResolvedValue(new Response(pcm, { headers: { "Content-Type": "audio/pcm" } }));
    const audio = await synthesizeElevenLabsAudio({
      ...REQUEST,
      synthesisResponseMode,
      ai: { gateway: () => ({ run }) },
    });
    expect(audio).toEqual(pcm);
    expect(run).toHaveBeenCalledExactlyOnceWith(
      {
        provider: "elevenlabs",
        endpoint: `v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb${synthesisResponseMode === "streaming" ? "/stream" : ""}?output_format=pcm_24000`,
        headers: { "Content-Type": "application/json", "cf-aig-collect-log-payload": false },
        query: {
          text: REQUEST.narrationText,
          model_id: "eleven_v3",
          voice_settings: { stability: 0.5 },
        },
      },
      {
        gateway: {
          id: "default",
          collectLog: true,
          metadata: {
            conversionId: REQUEST.conversionId,
            narrationSegmentSequence: 2,
            synthesisAttempt: 1,
            synthesisResponseMode,
          },
          requestTimeoutMs: 90_000,
        },
        signal: expect.any(AbortSignal),
      },
    );
  },
);

test.each([400, 401, 403, 404, 422, 408, 429, 500, 503])(
  "classifies status %s without falling back to Gemini",
  async (status) => {
    const run = vi
      .fn<ReturnType<SynthesisOptions["ai"]["gateway"]>["run"]>()
      .mockResolvedValue(Response.json({ detail: { message: "Provider error" } }, { status }));
    const error = await synthesizeElevenLabsAudio({
      ...REQUEST,
      ai: { gateway: () => ({ run }) },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof PermanentNarrationSynthesisError).toBe(
      status < 500 && status !== 408 && status !== 429,
    );
    expect(run).toHaveBeenCalledTimes(1);
  },
);

test.each([
  { contentType: "audio/mpeg", bytes: new Uint8Array([1, 2]) },
  { contentType: "application/json", bytes: new Uint8Array([1, 2]) },
  { contentType: "audio/pcm", bytes: new Uint8Array() },
  { contentType: "audio/pcm", bytes: new Uint8Array([1]) },
])("rejects invalid PCM before encoding ($contentType, $bytes)", async ({ contentType, bytes }) => {
  await expect(
    synthesizeElevenLabsAudio({
      ...REQUEST,
      ai: {
        gateway: () => ({
          run: async () => new Response(bytes, { headers: { "Content-Type": contentType } }),
        }),
      },
    }),
  ).rejects.toThrow("ElevenLabs narration synthesis returned");
});

test("stores ElevenLabs identity and refuses reuse under Gemini", async () => {
  let stored: StoredAudioSegment | null = null;
  const bucket: ProduceOptions["bucket"] = {
    head: async () => stored,
    put: async (key, audio, options) => {
      stored = { key, size: audio.byteLength, ...options };
      return stored;
    },
  };
  const options = {
    speechConfig: ELEVENLABS_SPEECH_CONFIG,
    ai: createFakeSpeechSynthesisAi(),
    bucket,
    conversionId: "conversion-id",
    sequence: 0,
    narrationChunk: { text: "An unchanged narration." },
  };
  const segment = await produceAudioSegment(options);
  expect(segment.speechConfig).toEqual(ELEVENLABS_SPEECH_CONFIG);
  await expect(produceAudioSegment(options)).resolves.toEqual(segment);
  await expect(
    produceAudioSegment({ ...options, speechConfig: GEMINI_SPEECH_CONFIG }),
  ).rejects.toThrow("identity conflicts");
});

test("validates legacy Gemini segments after changing the production default", () => {
  const object = {
    key: "conversions/conversion-id/audio-segments/0.mp3",
    size: 384,
    httpMetadata: { contentType: "audio/mpeg" },
    customMetadata: createAudioSegmentMetadata("Original narration", 24, 123, GEMINI_SPEECH_CONFIG),
  };
  const reference = createAudioSegmentReference(object, "conversion-id", 0);
  expect(reference.speechConfig).toEqual(GEMINI_SPEECH_CONFIG);
  expect(() => assertStoredAudioSegment(object, reference)).not.toThrow();
  const { speechConfig: _, ...legacyReference } = reference;
  expect(() => assertStoredAudioSegment(object, legacyReference)).not.toThrow();
  expect(() =>
    assertStoredAudioSegment(object, { ...reference, speechConfig: ELEVENLABS_SPEECH_CONFIG }),
  ).toThrow("unexpected synthesis metadata");
});
