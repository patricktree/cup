import { z } from "zod";

import { createConversionArtifactPrefix } from "@cup/conversion-contracts";
import { SYNCHRONIZATION_UNIT_SCHEMA } from "@cup/narration-document-creation";
import type { NarrationDocument } from "@cup/narration-document-creation";

import { AUDIOBOOK_MANIFEST_CONTENT_TYPE } from "#src/audio-format.ts";
import { SPEECH_CONFIG, type SpeechConfig } from "#src/speech-synthesis-config.ts";

/** Prepared narration; individual audio segments are published independently. */
export type Audiobook = {
  title: string;
  originalUrl: string;
  narrationDocument: NarrationDocument;
  speechConfig: SpeechConfig;
};

/** Identifies a stored canonical audiobook manifest. */
export type AudiobookReference = {
  key: string;
  contentType: typeof AUDIOBOOK_MANIFEST_CONTENT_TYPE;
  byteLength: number;
  etag: string;
};

/** Minimal object-storage operations required for canonical audiobook manifests. */
export type ManifestStorage = {
  get(key: string): Promise<{
    key: string;
    size: number;
    etag: string;
    httpMetadata?: { contentType?: string };
    text(): Promise<string>;
  } | null>;
  put(
    key: string,
    value: string,
    options: { httpMetadata: { contentType: typeof AUDIOBOOK_MANIFEST_CONTENT_TYPE } },
  ): Promise<{ key: string; size: number; etag: string } | null>;
};

/** Supplies the artifacts and source metadata used to create an audiobook manifest. */
export type StoreOptions = {
  artifactPrefix?: string;
  bucket: ManifestStorage;
  conversionId: string;
  title: string;
  originalUrl: string;
  narrationDocument: NarrationDocument;
  speechConfig?: SpeechConfig;
};

/** Supplies the storage dependency and expected identity of a manifest to load. */
export type LoadOptions = {
  bucket: ManifestStorage;
  audiobookReference: AudiobookReference;
};

export const audiobookSchema = z.object({
  title: z.string().min(1),
  originalUrl: z.url(),
  narrationDocument: z.object({
    html: z.string().min(1),
    synchronizationUnits: z.array(SYNCHRONIZATION_UNIT_SCHEMA).min(1),
  }),
  speechConfig: z
    .object({
      provider: z.enum(["google-ai-studio", "elevenlabs"]),
      model: z.string().min(1),
      voice: z.string().min(1),
      policyVersion: z.string().min(1),
    })
    .default(SPEECH_CONFIG),
});

/** Derives synchronization cues and stores the canonical audiobook manifest. */
export async function storeAudiobook({
  artifactPrefix,
  bucket,
  conversionId,
  title,
  originalUrl,
  narrationDocument,
  speechConfig = SPEECH_CONFIG,
}: StoreOptions): Promise<AudiobookReference> {
  const audiobook = audiobookSchema.parse({ title, originalUrl, narrationDocument, speechConfig });
  const body = JSON.stringify(audiobook);
  const key = `${artifactPrefix ?? createConversionArtifactPrefix(conversionId)}audiobook.json`;
  const storedManifest = await bucket.put(key, body, {
    httpMetadata: { contentType: AUDIOBOOK_MANIFEST_CONTENT_TYPE },
  });

  if (!storedManifest) {
    throw new Error(`Audiobook manifest upload did not produce an object: ${key}`);
  }

  return {
    key: storedManifest.key,
    contentType: AUDIOBOOK_MANIFEST_CONTENT_TYPE,
    byteLength: storedManifest.size,
    etag: storedManifest.etag,
  };
}

/** Loads and validates a stored audiobook against its manifest reference. */
export async function loadAudiobook({
  bucket,
  audiobookReference,
}: LoadOptions): Promise<Audiobook> {
  const storedManifest = await bucket.get(audiobookReference.key);

  if (!storedManifest) {
    throw new Error(`Audiobook manifest was not found in storage: ${audiobookReference.key}`);
  }

  if (
    storedManifest.httpMetadata?.contentType !== audiobookReference.contentType ||
    storedManifest.size !== audiobookReference.byteLength ||
    storedManifest.etag !== audiobookReference.etag
  ) {
    throw new Error(
      `Stored audiobook manifest does not match its reference: ${audiobookReference.key}`,
    );
  }

  return audiobookSchema.parse(JSON.parse(await storedManifest.text()));
}
