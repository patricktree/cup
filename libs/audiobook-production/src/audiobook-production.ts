export {
  PermanentNarrationSynthesisError,
  produceAudioSegment,
  type NarrationChunk,
  type NarrationSynthesisResponseMode,
  type ProduceOptions,
  type SpeechSynthesisAi,
} from "#src/produce-audio-segment.ts";
export { analyzeMp3, type Mp3Analysis } from "#src/audio-format.ts";
export {
  createAudioSegmentReference,
  type AudioSegmentReference,
} from "#src/audio-segment-storage.ts";
export {
  loadAudiobook,
  audiobookSchema,
  storeAudiobook,
  type Audiobook,
  type ManifestStorage,
  type AudiobookReference,
  type LoadOptions,
  type StoreOptions,
} from "#src/store-audiobook.ts";

export { SPEECH_CONFIG, type SpeechConfig } from "#src/speech-synthesis-config.ts";
export { getStoredSpeechConfig, createAudioSegmentKey } from "#src/audio-segment-storage.ts";
