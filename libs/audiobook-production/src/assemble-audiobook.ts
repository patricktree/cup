import { AUDIOBOOK_CONTENT_TYPE } from "#src/audio-format.ts";
import {
  assertStoredAudioSegment,
  getStoredSpeechConfig,
  type AudioSegmentReference,
  type StoredAudioSegment,
} from "#src/audio-segment-storage.ts";

/** Identifies the final MP3 object assembled from a conversion's audio segments. */
export type AudioReference = {
  key: string;
  contentType: typeof AUDIOBOOK_CONTENT_TYPE;
  byteLength: number;
  durationMilliseconds: number;
  etag: string;
};

/** Supplies the storage target and ordered segment sequence for audiobook assembly. */
export type AssembleOptions = {
  bucket: {
    get(key: string): Promise<(StoredAudioSegment & { body: ReadableStream<Uint8Array> }) | null>;
    put(
      key: string,
      body: ReadableStream<Uint8Array>,
      options: { httpMetadata: { contentType: string } },
    ): Promise<{ key: string; size: number; etag: string } | null>;
  };
  conversionId: string;
  audioSegments: readonly AudioSegmentReference[];
};

/** Streams contiguous MP3 segments into one stored audiobook without buffering the full output. */
export async function assembleAudiobook({
  bucket,
  conversionId,
  audioSegments,
}: AssembleOptions): Promise<AudioReference> {
  assertValidAudioSegmentReferences(conversionId, audioSegments);

  const audiobookByteLength = audioSegments.reduce(
    (total, audioSegment) => total + audioSegment.byteLength,
    0,
  );
  const durationMilliseconds = audioSegments.reduce(
    (total, audioSegment) => total + audioSegment.durationMilliseconds,
    0,
  );
  const key = `conversions/${conversionId}/audiobook.mp3`;
  const fixedLengthStream = new FixedLengthStream(audiobookByteLength);
  const writer = fixedLengthStream.writable.getWriter();
  const upload = bucket.put(key, fixedLengthStream.readable, {
    httpMetadata: { contentType: AUDIOBOOK_CONTENT_TYPE },
  });

  let synthesisIdentity: string | undefined;
  try {
    for (const audioSegment of audioSegments) {
      const audioObject = await bucket.get(audioSegment.key);

      if (!audioObject || !("body" in audioObject)) {
        throw new Error(
          `Audio segment was not found while assembling audiobook: ${audioSegment.key}`,
        );
      }

      assertStoredAudioSegment(audioObject, audioSegment);
      const identity = JSON.stringify(getStoredSpeechConfig(audioObject));
      if (synthesisIdentity !== undefined && synthesisIdentity !== identity) {
        throw new Error("Cannot assemble audio segments with different synthesis identities");
      }
      synthesisIdentity = identity;
      await writeAudioObject(audioObject, writer);
    }

    await writer.close();

    const audiobook = await upload;

    if (!audiobook) {
      throw new Error(`Audiobook upload did not produce an object: ${key}`);
    }

    return {
      key: audiobook.key,
      contentType: AUDIOBOOK_CONTENT_TYPE,
      byteLength: audiobook.size,
      durationMilliseconds,
      etag: audiobook.etag,
    };
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await upload.catch(() => undefined);
    throw error;
  }
}

function assertValidAudioSegmentReferences(
  conversionId: string,
  audioSegments: readonly AudioSegmentReference[],
): void {
  if (conversionId.trim().length === 0) {
    throw new Error("Cannot assemble an audiobook without a conversion ID");
  }

  if (audioSegments.length === 0) {
    throw new Error("Cannot assemble an audiobook without audio segments");
  }

  for (const [expectedSequence, audioSegment] of audioSegments.entries()) {
    if (audioSegment.conversionId !== conversionId) {
      throw new Error(
        `Audio segment belongs to a different conversion: ${audioSegment.key} (${audioSegment.conversionId})`,
      );
    }

    if (audioSegment.sequence !== expectedSequence) {
      throw new Error(
        `Audio segments must have unique contiguous sequences starting at zero: expected ${expectedSequence}, got ${audioSegment.sequence}`,
      );
    }

    if (!Number.isSafeInteger(audioSegment.byteLength) || audioSegment.byteLength <= 0) {
      throw new Error(
        `Audio segment byte length must be a positive safe integer: ${audioSegment.byteLength}`,
      );
    }

    if (
      !Number.isFinite(audioSegment.durationMilliseconds) ||
      audioSegment.durationMilliseconds <= 0
    ) {
      throw new Error(
        `Audio segment duration must be a positive finite number: ${audioSegment.durationMilliseconds}`,
      );
    }

    if (
      !Number.isSafeInteger(audioSegment.crc32) ||
      audioSegment.crc32 < 0 ||
      audioSegment.crc32 > 0xffff_ffff
    ) {
      throw new Error(
        `Audio segment CRC-32 must be an unsigned 32-bit integer: ${audioSegment.crc32}`,
      );
    }
  }
}

async function writeAudioObject(
  audioObject: { key: string; body: ReadableStream<Uint8Array> },
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
  const reader = audioObject.body.getReader();

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        return;
      }

      if (!(result.value instanceof Uint8Array)) {
        throw new Error(`Audio segment contained a non-binary body: ${audioObject.key}`);
      }

      await writer.write(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}
