import { encodePcmAsMp3 } from "@cup/mp3-encoding";

import { AUDIO_FORMAT, AUDIOBOOK_CONTENT_TYPE, analyzeMp3 } from "#src/audio-format.ts";
import {
  assertMatchingAudioSegmentIdentity,
  createAudioSegmentReference,
  createAudioSegmentKey,
  createAudioSegmentMetadata,
  type AudioSegmentReference,
  type StoredAudioSegment,
} from "#src/audio-segment-storage.ts";
import { calculateCrc32 } from "#src/crc32.ts";
import { SPEECH_CONFIG, type SpeechConfig } from "#src/speech-synthesis-config.ts";
import type {
  SpeechSynthesizer,
  SpeechSynthesisAi,
  NarrationChunk,
  NarrationSynthesisResponseMode,
} from "#src/speech-synthesis.ts";
import { synthesizeElevenLabsAudio } from "#src/synthesize-elevenlabs-audio.ts";
import { synthesizeGeminiAudio } from "#src/synthesize-gemini-audio.ts";
export {
  PermanentNarrationSynthesisError,
  type SpeechSynthesisAi,
  type NarrationChunk,
  type NarrationSynthesisResponseMode,
} from "#src/speech-synthesis.ts";

const MP3_BITRATE_KILOBITS_PER_SECOND = 128;

const speechProviderToSynthesizeMap = {
  elevenlabs: synthesizeElevenLabsAudio,
  "google-ai-studio": synthesizeGeminiAudio,
} as const satisfies {
  [provider in SpeechConfig["provider"]]: SpeechSynthesizer;
};

/** Storage operations required to persist one audio segment. */
type AudioSegmentBucket = {
  head(key: string): Promise<StoredAudioSegment | null>;
  put(
    key: string,
    value: Uint8Array,
    options: {
      onlyIf: Headers;
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ): Promise<StoredAudioSegment | null>;
};

/** Supplies synthesis, storage, ownership, and sequence data for one narration segment. */
export type ProduceOptions = {
  speechConfig?: SpeechConfig;
  ai: SpeechSynthesisAi;
  bucket: AudioSegmentBucket;
  conversionId: string;
  sequence: number;
  narrationChunk: NarrationChunk;
  synthesisAttempt?: number;
  synthesisResponseMode?: NarrationSynthesisResponseMode;
};

/** Synthesizes and stores one segment, reusing an identical existing object when possible. */
export async function produceAudioSegment({
  ai,
  speechConfig = SPEECH_CONFIG,
  bucket,
  conversionId,
  sequence,
  narrationChunk,
  synthesisAttempt = 1,
  synthesisResponseMode = "streaming",
}: ProduceOptions): Promise<AudioSegmentReference> {
  assertAudioSegmentIdentity(conversionId, sequence);
  assertSynthesisAttempt(synthesisAttempt);

  if (narrationChunk.text.trim().length === 0) {
    throw new Error("Cannot produce an audio segment from an empty narration chunk");
  }

  const key = createAudioSegmentKey(conversionId, sequence);
  const expectedMetadata = createAudioSegmentMetadata(
    narrationChunk.text,
    undefined,
    undefined,
    speechConfig,
  );
  const existingAudioObject = await bucket.head(key);

  if (existingAudioObject) {
    return reuseAudioSegment(existingAudioObject, conversionId, sequence, expectedMetadata);
  }

  const synthesize = speechProviderToSynthesizeMap[speechConfig.provider];
  const providerAudio = await synthesize({
    speechConfig,
    ai,
    conversionId,
    narrationText: narrationChunk.text,
    sequence,
    synthesisAttempt,
    synthesisResponseMode,
  });
  const encodedAudio = await encodePcmAsMp3(providerAudio, {
    bitrateKilobitsPerSecond: MP3_BITRATE_KILOBITS_PER_SECOND,
    sampleRate: AUDIO_FORMAT.sampleRate,
  });
  const { audioStart, audioEnd, durationMilliseconds } = analyzeMp3(encodedAudio);
  const audio = encodedAudio.slice(audioStart, audioEnd);
  const customMetadata = createAudioSegmentMetadata(
    narrationChunk.text,
    durationMilliseconds,
    calculateCrc32(audio),
    speechConfig,
  );

  const audioObject = await bucket.put(key, audio, {
    onlyIf: new Headers({ "If-None-Match": "*" }),
    httpMetadata: { contentType: AUDIOBOOK_CONTENT_TYPE },
    customMetadata,
  });

  if (audioObject) {
    return createAudioSegmentReference(audioObject, conversionId, sequence);
  }

  const concurrentlyStoredAudioObject = await bucket.head(key);

  if (!concurrentlyStoredAudioObject) {
    throw new Error(`Audio segment conditional write failed without an existing object: ${key}`);
  }

  return reuseAudioSegment(concurrentlyStoredAudioObject, conversionId, sequence, customMetadata);
}

function reuseAudioSegment(
  audioObject: StoredAudioSegment,
  conversionId: string,
  sequence: number,
  expectedMetadata: Readonly<Record<string, string>>,
): AudioSegmentReference {
  assertMatchingAudioSegmentIdentity(audioObject, expectedMetadata);

  return createAudioSegmentReference(audioObject, conversionId, sequence);
}

function assertAudioSegmentIdentity(conversionId: string, sequence: number): void {
  if (conversionId.trim().length === 0) {
    throw new Error("Cannot produce an audio segment without a conversion ID");
  }

  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error(`Audio segment sequence must be a non-negative safe integer: ${sequence}`);
  }
}

function assertSynthesisAttempt(synthesisAttempt: number): void {
  if (!Number.isSafeInteger(synthesisAttempt) || synthesisAttempt < 1) {
    throw new Error(`Synthesis attempt must be a positive safe integer: ${synthesisAttempt}`);
  }
}
