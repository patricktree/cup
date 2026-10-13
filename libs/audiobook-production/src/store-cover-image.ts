import { z } from "zod";

import { createConversionArtifactPrefix } from "@cup/conversion-contracts";

const COVER_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;
export type CoverImageContentType = (typeof COVER_IMAGE_CONTENT_TYPES)[number];

/** What the audiobook manifest records about its stored cover image. */
export const coverImageSchema = z
  .object({
    contentType: z.enum(COVER_IMAGE_CONTENT_TYPES),
    byteLength: z.number().int().positive().safe(),
    alternativeText: z.string().min(1).optional(),
  })
  .strict();
export type CoverImage = z.infer<typeof coverImageSchema>;

/** Minimal object-storage operations required to store a cover image. */
export type CoverImageStorage = {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: CoverImageContentType } },
  ): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>;
};

/** Supplies the publisher's original image bytes and where to keep them. */
export type StoreCoverImageOptions = {
  alternativeText?: string;
  artifactPrefix?: string;
  bucket: CoverImageStorage;
  bytes: Uint8Array;
  contentType: CoverImageContentType;
  conversionId: string;
};

export function createCoverImageKey(conversionId: string, artifactPrefix?: string): string {
  return `${artifactPrefix ?? createConversionArtifactPrefix(conversionId)}cover-image`;
}

/** Stores the cover image unchanged and returns its record for the audiobook manifest. */
export async function storeCoverImage({
  alternativeText,
  artifactPrefix,
  bucket,
  bytes,
  contentType,
  conversionId,
}: StoreCoverImageOptions): Promise<CoverImage> {
  const key = createCoverImageKey(conversionId, artifactPrefix);
  const storedImage = await bucket.put(key, bytes, { httpMetadata: { contentType } });

  if (!storedImage) {
    throw new Error(`Cover image upload did not produce an object: ${key}`);
  }

  // The account artifact writer answers a repeated write with the object it already stored, so
  // the record describes the stored object rather than the bytes offered in this attempt.
  return coverImageSchema.parse({
    contentType: storedImage.httpMetadata?.contentType,
    byteLength: storedImage.size,
    ...(alternativeText === undefined ? {} : { alternativeText }),
  });
}
