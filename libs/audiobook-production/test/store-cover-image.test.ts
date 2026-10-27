import { expect, test } from "vitest";

import { createCoverImageKey, storeCoverImage } from "#src/index.ts";

const BYTES = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);

test("stores the original bytes under the conversion prefix with their content type", async () => {
  const puts: Array<{ key: string; value: Uint8Array; contentType: string }> = [];

  const coverImage = await storeCoverImage({
    artifactPrefix: "accounts/account-id/conversions/conversion-id/",
    bucket: {
      put: async (key, value, { httpMetadata }) => {
        puts.push({ key, value, contentType: httpMetadata.contentType });
        return { size: value.byteLength, httpMetadata };
      },
    },
    bytes: BYTES,
    contentType: "image/jpeg",
    conversionId: "conversion-id",
    alternativeText: "A lighthouse at dusk",
  });

  expect(puts).toEqual([
    {
      key: "accounts/account-id/conversions/conversion-id/cover-image",
      value: BYTES,
      contentType: "image/jpeg",
    },
  ]);
  expect(coverImage).toEqual({
    contentType: "image/jpeg",
    byteLength: 4,
    alternativeText: "A lighthouse at dusk",
  });
});

test("uses the trial layout when no artifact prefix is supplied", () => {
  expect(createCoverImageKey("conversion-id")).toBe("conversions/conversion-id/cover-image");
});

test("describes the object storage kept when a repeated write is answered with an earlier one", async () => {
  const coverImage = await storeCoverImage({
    bucket: {
      put: async () => ({ size: 9000, httpMetadata: { contentType: "image/png" } }),
    },
    bytes: BYTES,
    contentType: "image/jpeg",
    conversionId: "conversion-id",
  });

  expect(coverImage).toEqual({ contentType: "image/png", byteLength: 9000 });
});

test("fails when storage produces no object", async () => {
  await expect(
    storeCoverImage({
      bucket: { put: async () => null },
      bytes: BYTES,
      contentType: "image/jpeg",
      conversionId: "conversion-id",
    }),
  ).rejects.toThrow("did not produce an object");
});
