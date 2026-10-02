import { z } from "zod";

import { createConversionArtifactPrefix } from "@cup/conversion-contracts";
import { SYNCHRONIZATION_UNIT_SCHEMA } from "@cup/narration-document-creation";
import type { NarrationDocument } from "@cup/narration-document-creation";

import type { AudioReference } from "#src/assemble-audiobook.ts";
import { AUDIOBOOK_CONTENT_TYPE, AUDIOBOOK_MANIFEST_CONTENT_TYPE } from "#src/audio-format.ts";
import type { AudioSegmentReference } from "#src/audio-segment-storage.ts";

const audiobookAudioReferenceSchema = z.object({
  key: z.string().min(1),
  contentType: z.literal(AUDIOBOOK_CONTENT_TYPE),
  byteLength: z.number().int().positive().safe(),
  durationMilliseconds: z.number().finite().positive(),
  etag: z.string().min(1),
});
const synchronizationCueSchema = z.object({
  synchronizationUnitId: z.string().min(1),
  startMilliseconds: z.number().finite().nonnegative(),
  endMilliseconds: z.number().finite().positive(),
});

/** Maps one synchronization unit to its half-open interval in the assembled audio. */
export type SynchronizationCue = {
  synchronizationUnitId: string;
  startMilliseconds: number;
  endMilliseconds: number;
};

/** Canonical synchronized audiobook stored for one conversion. */
export type Audiobook = {
  title: string;
  originalUrl: string;
  narrationDocument: NarrationDocument;
  audio: AudioReference;
  synchronizationCues: readonly SynchronizationCue[];
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
  audio: AudioReference;
  audioSegments: readonly AudioSegmentReference[];
};

/** Supplies the storage dependency and expected identity of a manifest to load. */
export type LoadOptions = {
  bucket: ManifestStorage;
  audiobookReference: AudiobookReference;
};

export const audiobookSchema: z.ZodType<Audiobook> = z
  .object({
    title: z.string().min(1),
    originalUrl: z.url(),
    narrationDocument: z.object({
      html: z.string().min(1),
      synchronizationUnits: z.array(SYNCHRONIZATION_UNIT_SCHEMA).min(1),
    }),
    audio: audiobookAudioReferenceSchema,
    synchronizationCues: z.array(synchronizationCueSchema).min(1),
  })
  .superRefine((audiobook, context) => {
    const { synchronizationUnits } = audiobook.narrationDocument;

    if (synchronizationUnits.length !== audiobook.synchronizationCues.length) {
      context.addIssue({
        code: "custom",
        message: "Audiobook requires one synchronization cue for every synchronization unit",
      });
      return;
    }

    for (const [sequence, synchronizationCue] of audiobook.synchronizationCues.entries()) {
      const expectedStartMilliseconds =
        sequence === 0 ? 0 : audiobook.synchronizationCues[sequence - 1]!.endMilliseconds;

      if (
        synchronizationCue.synchronizationUnitId !== synchronizationUnits[sequence]!.id ||
        synchronizationCue.startMilliseconds !== expectedStartMilliseconds ||
        synchronizationCue.endMilliseconds <= synchronizationCue.startMilliseconds
      ) {
        context.addIssue({
          code: "custom",
          message: `Audiobook has an invalid synchronization cue at sequence ${sequence}`,
        });
      }
    }

    try {
      if (
        audiobook.synchronizationCues.at(-1)!.endMilliseconds !==
        audiobook.audio.durationMilliseconds
      ) {
        context.addIssue({
          code: "custom",
          message: "Audiobook synchronization cues must span its playback audio",
        });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Audiobook audio has an invalid duration",
      });
    }
  });

/** Derives synchronization cues and stores the canonical audiobook manifest. */
export async function storeAudiobook({
  artifactPrefix,
  bucket,
  conversionId,
  title,
  originalUrl,
  narrationDocument,
  audio,
  audioSegments,
}: StoreOptions): Promise<AudiobookReference> {
  if (narrationDocument.synchronizationUnits.length !== audioSegments.length) {
    throw new Error("Audiobook requires one audio segment for every synchronization unit");
  }

  const expectedAudioByteLength = audioSegments.reduce(
    (total, audioSegment) => total + audioSegment.byteLength,
    0,
  );

  if (audio.byteLength !== expectedAudioByteLength) {
    throw new Error("Audiobook audio byte length does not match its audio segments");
  }

  let playbackPositionMilliseconds = 0;
  const synchronizationCues = narrationDocument.synchronizationUnits.map(
    (synchronizationUnit, sequence): SynchronizationCue => {
      const audioSegment = audioSegments[sequence];

      if (
        audioSegment === undefined ||
        audioSegment.conversionId !== conversionId ||
        audioSegment.sequence !== sequence
      ) {
        throw new Error(
          `Audio segment does not match conversion ${conversionId} sequence ${sequence}`,
        );
      }

      const startMilliseconds = playbackPositionMilliseconds;

      playbackPositionMilliseconds += audioSegment.durationMilliseconds;

      return {
        synchronizationUnitId: synchronizationUnit.id,
        startMilliseconds,
        endMilliseconds: playbackPositionMilliseconds,
      };
    },
  );
  const audiobook = audiobookSchema.parse({
    title,
    originalUrl,
    narrationDocument,
    audio,
    synchronizationCues,
  });
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
