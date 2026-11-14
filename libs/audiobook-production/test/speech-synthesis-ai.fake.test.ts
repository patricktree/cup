import { expect, test } from "vitest";

import { produceAudioSegment, type ProduceOptions } from "#src/produce-audio-segment.ts";
import { createFakeSpeechSynthesisAi } from "#src/speech-synthesis-ai.fake.ts";

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
