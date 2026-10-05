import { expect, test } from "vitest";

import {
  loadAudiobook,
  storeAudiobook,
  SPEECH_CONFIG,
  type StoreOptions,
} from "#src/audiobook-production.ts";

const document = {
  html: '<h1 id="unit-1">Title</h1><p id="unit-2">Body</p>',
  synchronizationUnits: [
    { id: "unit-1", narrationText: "Title" },
    { id: "unit-2", narrationText: "Body" },
  ],
};
test("publishes prepared narration without requiring any audio and fixes the speech configuration", async () => {
  const { bucket, storedObjects } = createTestBucket();
  const reference = await storeAudiobook({
    bucket,
    conversionId: "conversion-id",
    title: "Title",
    originalUrl: "https://example.com",
    narrationDocument: document,
  });
  expect([...storedObjects.keys()]).toEqual(["conversions/conversion-id/audiobook.json"]);
  const audiobook = await loadAudiobook({ bucket, audiobookReference: reference });
  expect(audiobook).toEqual({
    title: "Title",
    originalUrl: "https://example.com",
    narrationDocument: document,
    speechConfig: SPEECH_CONFIG,
  });
  expect(audiobook).not.toHaveProperty("audio");
});
test("rejects invalid narration before publishing a prepared artifact", async () => {
  const { bucket, storedObjects } = createTestBucket();
  await expect(
    storeAudiobook({
      bucket,
      conversionId: "conversion-id",
      title: "Title",
      originalUrl: "not a URL",
      narrationDocument: document,
    }),
  ).rejects.toThrow("Invalid URL");
  expect(storedObjects.size).toBe(0);
});
type StoredTestObject = {
  body: string;
  httpMetadata: { contentType?: string };
};

function createTestBucket(): {
  bucket: StoreOptions["bucket"];
  storedObjects: Map<string, StoredTestObject>;
} {
  const storedObjects = new Map<string, StoredTestObject>();
  const bucket: StoreOptions["bucket"] = {
    get: async (key: string) => {
      const storedObject = storedObjects.get(key);

      if (storedObject === undefined) {
        return null;
      }

      return {
        key,
        size: new TextEncoder().encode(storedObject.body).byteLength,
        etag: "manifest-etag",
        httpMetadata: storedObject.httpMetadata,
        text: async () => storedObject.body,
      };
    },
    put: async (key: string, value: string, options) => {
      storedObjects.set(key, { body: value, httpMetadata: options.httpMetadata });

      return {
        key,
        size: new TextEncoder().encode(value).byteLength,
        etag: "manifest-etag",
      };
    },
  };

  return { bucket, storedObjects };
}
