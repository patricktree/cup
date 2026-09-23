import { AUDIO_FORMAT, AUDIOBOOK_CONTENT_TYPE } from "#src/audio-format.ts";
import {
  SPEECH_CONFIG,
  GEMINI_SPEECH_CONFIG,
  ELEVENLABS_SPEECH_CONFIG,
  type SpeechConfig,
} from "#src/speech-synthesis-config.ts";

// https://developers.cloudflare.com/r2/platform/limits/
const R2_OBJECT_METADATA_MAX_BYTE_LENGTH = 8_192;

const SEGMENT_METADATA_KEYS = {
  channelCount: "audio-channel-count",
  crc32: "audio-crc32",
  durationMilliseconds: "audio-duration-milliseconds",
  encoding: "audio-encoding",
  model: "synthesis-model",
  narrationText: "narration-text",
  policyVersion: "synthesis-policy-version",
  provider: "synthesis-provider",
  sampleRate: "audio-sample-rate",
  voice: "synthesis-voice",
} as const;

/** Identifies one stored MP3 segment and its position within a conversion. */
export type AudioSegmentReference = {
  conversionId: string;
  sequence: number;
  key: string;
  byteLength: number;
  durationMilliseconds: number;
  crc32: number;
  speechConfig?: SpeechConfig;
};

/** R2 object metadata required to validate and reuse an audio segment. */
export type StoredAudioSegment = {
  key: string;
  size: number;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

/** Creates the canonical R2 key for a conversion's segment sequence. */
export function createAudioSegmentKey(conversionId: string, sequence: number): string {
  return `conversions/${conversionId}/audio-segments/${sequence}.mp3`;
}

/** Serializes the synthesis identity and optional analyzed audio metadata for R2. */
export function createAudioSegmentMetadata(
  narrationText: string,
  durationMilliseconds?: number,
  crc32?: number,
  speechConfig: SpeechConfig = SPEECH_CONFIG,
): Record<string, string> {
  if ((durationMilliseconds === undefined) !== (crc32 === undefined)) {
    throw new Error("Audio segment duration and CRC-32 metadata must be provided together");
  }

  if (
    durationMilliseconds !== undefined &&
    (!Number.isFinite(durationMilliseconds) || durationMilliseconds <= 0)
  ) {
    throw new Error("Audio segment duration metadata must be a positive finite number");
  }

  if (crc32 !== undefined && (!Number.isSafeInteger(crc32) || crc32 < 0 || crc32 > 0xffff_ffff)) {
    throw new Error("Audio segment CRC-32 metadata must be an unsigned 32-bit integer");
  }

  const metadata = {
    [SEGMENT_METADATA_KEYS.channelCount]: AUDIO_FORMAT.channelCount.toString(),
    [SEGMENT_METADATA_KEYS.encoding]: AUDIO_FORMAT.encoding,
    [SEGMENT_METADATA_KEYS.model]: speechConfig.model,
    // JSON preserves the exact input while keeping line breaks safe for metadata header transport.
    [SEGMENT_METADATA_KEYS.narrationText]: JSON.stringify(narrationText),
    [SEGMENT_METADATA_KEYS.policyVersion]: speechConfig.policyVersion,
    [SEGMENT_METADATA_KEYS.provider]: speechConfig.provider,
    [SEGMENT_METADATA_KEYS.sampleRate]: AUDIO_FORMAT.sampleRate.toString(),
    [SEGMENT_METADATA_KEYS.voice]: speechConfig.voice,
    ...(durationMilliseconds === undefined
      ? {}
      : {
          [SEGMENT_METADATA_KEYS.durationMilliseconds]: durationMilliseconds.toString(),
        }),
    ...(crc32 === undefined ? {} : { [SEGMENT_METADATA_KEYS.crc32]: crc32.toString(16) }),
  };

  assertR2MetadataFits(metadata);

  return metadata;
}

/** Verifies that a stored object still matches its segment reference and synthesis policy. */
export function assertStoredAudioSegment(
  audioObject: StoredAudioSegment,
  audioSegment: AudioSegmentReference,
): void {
  const expectedKey = createAudioSegmentKey(audioSegment.conversionId, audioSegment.sequence);
  const httpMetadata = audioObject.httpMetadata ?? {};
  const customMetadata = audioObject.customMetadata ?? {};

  if (audioSegment.key !== expectedKey || audioObject.key !== expectedKey) {
    throw new Error(
      `Audio segment key does not match conversion ${audioSegment.conversionId} sequence ${audioSegment.sequence}`,
    );
  }

  if (httpMetadata.contentType !== AUDIOBOOK_CONTENT_TYPE) {
    throw new Error(
      `Audio segment has unexpected content type: ${audioObject.key} (${httpMetadata.contentType ?? "missing"})`,
    );
  }

  if (!hasExpectedFixedSynthesisMetadata(customMetadata, audioSegment.speechConfig)) {
    throw new Error(`Audio segment has unexpected synthesis metadata: ${audioObject.key}`);
  }

  if (!hasNonEmptyNarrationText(customMetadata[SEGMENT_METADATA_KEYS.narrationText])) {
    throw new Error(`Audio segment has empty narration text metadata: ${audioObject.key}`);
  }

  if (audioObject.size !== audioSegment.byteLength) {
    throw new Error(
      `Audio segment has unexpected size: ${audioObject.key} (expected ${audioSegment.byteLength}, got ${audioObject.size})`,
    );
  }

  assertValidAudioSegmentByteLength(audioObject.size);

  if (getStoredAudioSegmentDuration(customMetadata) !== audioSegment.durationMilliseconds) {
    throw new Error(`Audio segment has unexpected duration metadata: ${audioObject.key}`);
  }

  if (getStoredAudioSegmentCrc32(customMetadata) !== audioSegment.crc32) {
    throw new Error(`Audio segment has unexpected CRC-32 metadata: ${audioObject.key}`);
  }
}

/** Verifies that an existing object is safe to reuse for the requested synthesis input. */
export function assertMatchingAudioSegmentIdentity(
  audioObject: StoredAudioSegment,
  expectedMetadata: Readonly<Record<string, string>>,
): void {
  const httpMetadata = audioObject.httpMetadata ?? {};
  const customMetadata = audioObject.customMetadata ?? {};

  if (
    httpMetadata.contentType !== AUDIOBOOK_CONTENT_TYPE ||
    !hasSameSynthesisMetadata(customMetadata, expectedMetadata)
  ) {
    throw new Error(`Audio segment identity conflicts with existing object: ${audioObject.key}`);
  }

  assertValidAudioSegmentByteLength(audioObject.size);
  getStoredAudioSegmentDuration(customMetadata);
  getStoredAudioSegmentCrc32(customMetadata);
}

/** Builds a reusable segment reference from validated stored-object metadata. */
export function createAudioSegmentReference(
  audioObject: StoredAudioSegment,
  conversionId: string,
  sequence: number,
): AudioSegmentReference {
  return {
    conversionId,
    sequence,
    key: audioObject.key,
    byteLength: audioObject.size,
    durationMilliseconds: getStoredAudioSegmentDuration(audioObject.customMetadata ?? {}),
    crc32: getStoredAudioSegmentCrc32(audioObject.customMetadata ?? {}),
    speechConfig: getStoredSpeechConfig(audioObject),
  };
}

function getStoredAudioSegmentDuration(metadata: Readonly<Record<string, string>>): number {
  const duration = Number(metadata[SEGMENT_METADATA_KEYS.durationMilliseconds]);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Audio segment duration metadata must be a positive finite number");
  }

  return duration;
}

function getStoredAudioSegmentCrc32(metadata: Readonly<Record<string, string>>): number {
  const value = metadata[SEGMENT_METADATA_KEYS.crc32];

  if (value === undefined || !/^[\da-f]{1,8}$/u.test(value)) {
    throw new Error("Audio segment CRC-32 metadata must be a hexadecimal 32-bit value");
  }

  return Number.parseInt(value, 16);
}

function hasExpectedFixedSynthesisMetadata(
  metadata: Readonly<Record<string, string>>,
  speechConfig?: SpeechConfig,
): boolean {
  if (!speechConfig) {
    return [GEMINI_SPEECH_CONFIG, ELEVENLABS_SPEECH_CONFIG].some((config) =>
      hasExpectedFixedSynthesisMetadata(metadata, config),
    );
  }
  return (
    metadata[SEGMENT_METADATA_KEYS.channelCount] === AUDIO_FORMAT.channelCount.toString() &&
    metadata[SEGMENT_METADATA_KEYS.encoding] === AUDIO_FORMAT.encoding &&
    metadata[SEGMENT_METADATA_KEYS.model] === speechConfig.model &&
    typeof metadata[SEGMENT_METADATA_KEYS.narrationText] === "string" &&
    metadata[SEGMENT_METADATA_KEYS.policyVersion] === speechConfig.policyVersion &&
    metadata[SEGMENT_METADATA_KEYS.provider] === speechConfig.provider &&
    metadata[SEGMENT_METADATA_KEYS.sampleRate] === AUDIO_FORMAT.sampleRate.toString() &&
    metadata[SEGMENT_METADATA_KEYS.voice] === speechConfig.voice
  );
}

function hasSameSynthesisMetadata(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const expectedKeys = Object.keys(expected);

  return expectedKeys.every((key) => actual[key] === expected[key]);
}

function assertValidAudioSegmentByteLength(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new Error(`Audio segment byte length must be a positive safe integer: ${byteLength}`);
  }
}

function hasNonEmptyNarrationText(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  try {
    const narrationText = JSON.parse(value) as unknown;

    return typeof narrationText === "string" && narrationText.trim().length > 0;
  } catch {
    return false;
  }
}

function assertR2MetadataFits(metadata: Readonly<Record<string, string>>): void {
  const encoder = new TextEncoder();
  const byteLength = Object.entries(metadata).reduce(
    (total, [key, value]) => {
      return total + encoder.encode(`x-amz-meta-${key}:${value}\r\n`).byteLength;
    },
    encoder.encode(`content-type:${AUDIOBOOK_CONTENT_TYPE}\r\n`).byteLength,
  );

  if (byteLength > R2_OBJECT_METADATA_MAX_BYTE_LENGTH) {
    throw new Error(
      `Audio segment synthesis metadata exceeds the R2 object metadata limit: ${byteLength} bytes`,
    );
  }
}

/** Reads the original synthesis identity independently of the current production default. */
export function getStoredSpeechConfig(audioObject: StoredAudioSegment): SpeechConfig {
  const metadata = audioObject.customMetadata ?? {};
  const speechConfig = {
    provider: metadata[SEGMENT_METADATA_KEYS.provider],
    model: metadata[SEGMENT_METADATA_KEYS.model],
    voice: metadata[SEGMENT_METADATA_KEYS.voice],
    policyVersion: metadata[SEGMENT_METADATA_KEYS.policyVersion],
  };
  if (
    (speechConfig.provider !== "elevenlabs" && speechConfig.provider !== "google-ai-studio") ||
    !speechConfig.model ||
    !speechConfig.voice ||
    !speechConfig.policyVersion
  ) {
    throw new Error(`Audio segment has invalid synthesis identity: ${audioObject.key}`);
  }
  return {
    ...speechConfig,
    provider: speechConfig.provider,
    model: speechConfig.model,
    voice: speechConfig.voice,
    policyVersion: speechConfig.policyVersion,
  };
}
