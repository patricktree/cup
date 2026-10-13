import { z } from "zod";

import { createConversionArtifactPrefix } from "@cup/conversion-contracts";

const HERO_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type HeroImageContentType = (typeof HERO_IMAGE_CONTENT_TYPES)[number];

/** What the audiobook manifest records about its stored hero image. */
export const heroImageSchema = z
  .object({
    contentType: z.enum(HERO_IMAGE_CONTENT_TYPES),
    byteLength: z.number().int().positive().safe(),
    alternativeText: z.string().min(1).optional(),
  })
  .strict();
export type HeroImage = z.infer<typeof heroImageSchema>;

/** Minimal object-storage operations required to store a hero image. */
export type HeroImageStorage = {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: HeroImageContentType } },
  ): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>;
};

/** Supplies the publisher's original image bytes and where to keep them. */
export type StoreHeroImageOptions = {
  alternativeText?: string;
  artifactPrefix?: string;
  bucket: HeroImageStorage;
  bytes: Uint8Array;
  contentType: HeroImageContentType;
  conversionId: string;
};

export function createHeroImageKey(conversionId: string, artifactPrefix?: string): string {
  return `${artifactPrefix ?? createConversionArtifactPrefix(conversionId)}hero-image`;
}

/** Stores the hero image unchanged and returns its record for the audiobook manifest. */
export async function storeHeroImage({
  alternativeText,
  artifactPrefix,
  bucket,
  bytes,
  contentType,
  conversionId,
}: StoreHeroImageOptions): Promise<HeroImage> {
  const key = createHeroImageKey(conversionId, artifactPrefix);
  const storedImage = await bucket.put(key, bytes, { httpMetadata: { contentType } });

  if (!storedImage) {
    throw new Error(`Hero image upload did not produce an object: ${key}`);
  }

  // The account artifact writer answers a repeated write with the object it already stored, so
  // the record describes the stored object rather than the bytes offered in this attempt.
  return heroImageSchema.parse({
    contentType: storedImage.httpMetadata?.contentType,
    byteLength: storedImage.size,
    ...(alternativeText === undefined ? {} : { alternativeText }),
  });
}
