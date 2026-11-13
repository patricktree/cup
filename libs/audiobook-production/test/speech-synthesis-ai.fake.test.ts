import { expect, test } from "vitest";
import { z } from "zod";

import { produceAudioSegment, type ProduceOptions } from "#src/produce-audio-segment.ts";
import { createFakeSpeechSynthesisAi } from "#src/speech-synthesis-ai.fake.ts";

const SAMPLE_RATE = 24_000;
const GATEWAY_METADATA = {
  conversionId: "018f4d80-5b9e-7a43-9cf4-8e192b37cbd8",
  narrationSegmentSequence: 3,
  synthesisAttempt: 1,
};
const GEMINI_AUDIO_RESPONSE_SCHEMA = z.object({
  steps: z.tuple([z.object({ content: z.tuple([z.object({ data: z.string() })]) })]),
});
const WHISPER_OUTPUT_SCHEMA = z.object({
  text: z.string(),
  segments: z.array(
    z.object({
      words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })),
    }),
  ),
});

test("passes deterministic PCM through production MP3 encoding", async () => {
  const objects = new Map<
    string,
    {
      key: string;
      size: number;
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  >();
  const bucket: ProduceOptions["bucket"] = {
    head: (key: string) => Promise.resolve(objects.get(key) ?? null),
    put: (
      key: string,
      value: Uint8Array,
      options: {
        onlyIf: Headers;
        httpMetadata: { contentType: string };
        customMetadata: Record<string, string>;
      },
    ) => {
      const object = {
        key,
        size: value.byteLength,
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      };
      objects.set(key, object);
      return Promise.resolve(object);
    },
  };

  const segment = await produceAudioSegment({
    ai: createFakeSpeechSynthesisAi(),
    bucket,
    conversionId: "018f4d80-5b9e-7a43-9cf4-8e192b37cbd8",
    sequence: 0,
    narrationChunk: { text: "Deterministic narration." },
  });

  expect(segment.byteLength).toBeGreaterThan(0);
  expect(segment.durationMilliseconds).toBeGreaterThanOrEqual(100);
});

test("returns a configured provider failure through the production adapter", async () => {
  const ai = createFakeSpeechSynthesisAi({ failureStatus: 503 });
  const response = await ai.gateway("default").run({
    provider: "google-ai-studio",
    endpoint: "v1beta/interactions",
    headers: {},
    query: {},
  });

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: { message: "Configured deterministic speech failure" },
  });
});

test("synthesizes a tone burst per word, with a short gap between words and a pause after a sentence or line", async () => {
  const ai = createFakeSpeechSynthesisAi();

  const pcm = await synthesize(ai, "One two.\n\nThree");

  // 200 ms per word, 50 ms between words, 400 ms after a sentence or line.
  expect(pcm.byteLength / 2 / SAMPLE_RATE).toBeCloseTo(1.05);
  expect(isLoudAt(pcm, 0.1)).toBe(true);
  expect(isLoudAt(pcm, 0.225)).toBe(false);
  expect(isLoudAt(pcm, 0.35)).toBe(true);
  expect(isLoudAt(pcm, 0.65)).toBe(false);
  expect(isLoudAt(pcm, 0.95)).toBe(true);
});

test("recognizes the word timings of the synthesis with the same gateway metadata", async () => {
  const ai = createFakeSpeechSynthesisAi();
  await synthesize(ai, "One two.\n\nThree");

  const response = await ai.run(
    "@cf/openai/whisper-large-v3-turbo",
    { audio: "" },
    { gateway: { id: "default", metadata: GATEWAY_METADATA }, returnRawResponse: true },
  );

  const output = WHISPER_OUTPUT_SCHEMA.parse(await response.json());
  expect(output.text).toBe("One two. Three");
  expect(output.segments.flatMap(({ words }) => words)).toEqual([
    { word: "One", start: 0, end: 0.2 },
    { word: "two.", start: 0.25, end: 0.45 },
    { word: "Three", start: 0.85, end: 1.05 },
  ]);
});

test("returns a configured speech recognition failure", async () => {
  const ai = createFakeSpeechSynthesisAi({ recognitionFailureStatus: 429 });

  const response = await ai.run(
    "@cf/openai/whisper-large-v3-turbo",
    { audio: "" },
    { gateway: { id: "default", metadata: GATEWAY_METADATA }, returnRawResponse: true },
  );

  expect(response.status).toBe(429);
});

async function synthesize(
  ai: ReturnType<typeof createFakeSpeechSynthesisAi>,
  text: string,
): Promise<Uint8Array> {
  const response = await ai.gateway("default").run(
    {
      provider: "google-ai-studio",
      endpoint: "v1beta/interactions",
      headers: {},
      query: { input: [{ type: "user_input", content: [{ type: "text", text }] }] },
    },
    { gateway: { id: "default", metadata: GATEWAY_METADATA } },
  );
  const { steps } = GEMINI_AUDIO_RESPONSE_SCHEMA.parse(await response.json());

  return Uint8Array.from(atob(steps[0].content[0].data), (character) => character.charCodeAt(0));
}

/** Tells whether the 10 ms around a point in time carry sound. */
function isLoudAt(pcm: Uint8Array, seconds: number): boolean {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  const firstSample = Math.round((seconds - 0.005) * SAMPLE_RATE);

  return samples
    .subarray(firstSample, firstSample + SAMPLE_RATE / 100)
    .some((sample) => Math.abs(sample) > 1_000);
}
