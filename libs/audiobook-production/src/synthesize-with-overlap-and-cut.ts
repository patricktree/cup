import { encodePcmAsMp3 } from "@cup/mp3-encoding";

import { AUDIO_FORMAT, analyzeMp3 } from "#src/audio-format.ts";
import { countSynthesizedWords, findCutPoint } from "#src/find-cut-point.ts";
import { recognizeSpeech } from "#src/recognize-speech.ts";
import { getSpeechRecognitionLanguage } from "#src/speech-recognition-language.ts";
import type {
  NarrationChunk,
  SpeechSynthesisAi,
  SpeechSynthesizer,
  SynthesisOptions,
} from "#src/speech-synthesis.ts";

type OverlapAndCutFallbackReason = "no-cut-point" | "cut-check-failed" | "language-unrecognized";

// A chunk that continues its narration block reads on mid-paragraph; other narration chunks meet
// at the narration element separator narration chunks already use.
const BLOCK_CONTINUATION_SEPARATOR = " ";
const PARAGRAPH_SEPARATOR = "\n\n";

const LETTER_PATTERN = /\p{L}/u;
const LINE_END_PATTERN = /\n\s*$/u;

/**
 * Synthesizes a narration chunk with overlap and cut and returns its provider PCM: the previous
 * chunk's last whole sentence is spoken in front of the chunk, and everything before the cut point
 * that speech recognition finds is cut away. When the narration language is one speech recognition
 * does not support, or the cut check rejects the cut point, the chunk is synthesized alone instead,
 * and a warning logs the reason. Speech recognition errors are raised, never fallen back from.
 */
export async function synthesizeWithOverlapAndCut(
  options: SynthesisOptions & {
    ai: SpeechSynthesisAi;
    synthesize: SpeechSynthesizer;
    previousNarrationChunk: NarrationChunk;
    /** Whether the narration chunk continues the previous chunk's narration block. */
    continuesNarrationBlock: boolean;
  },
): Promise<Uint8Array> {
  const {
    synthesize,
    previousNarrationChunk,
    continuesNarrationBlock,
    narrationText,
    narrationLanguage,
  } = options;

  const recognitionLanguage =
    narrationLanguage === undefined ? undefined : getSpeechRecognitionLanguage(narrationLanguage);
  if (narrationLanguage !== undefined && recognitionLanguage === undefined) {
    return synthesizeAlone(options, "language-unrecognized");
  }

  const overlapSentence = selectLastSentence(previousNarrationChunk.text, narrationLanguage);
  const separator = continuesNarrationBlock ? BLOCK_CONTINUATION_SEPARATOR : PARAGRAPH_SEPARATOR;
  const synthesizedText = `${overlapSentence}${separator}${narrationText}`;

  const providerPcm = await synthesize({ ...options, narrationText: synthesizedText });
  const recognizedWords = await recognizeSpeech({
    ai: options.ai,
    mp3: await encodeMp3Frames(providerPcm),
    recognitionLanguage,
    conversionId: options.conversionId,
    sequence: options.sequence,
    synthesisAttempt: options.synthesisAttempt,
  });

  const cutPoint = findCutPoint({
    synthesizedText,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords,
    providerPcm,
  });
  if (!cutPoint.isAccepted) {
    return synthesizeAlone(options, cutPoint.reason);
  }

  const cutPointByteOffset = Math.round(cutPoint.cutPointSeconds * AUDIO_FORMAT.sampleRate) * 2;

  return providerPcm.subarray(cutPointByteOffset);
}

/** Synthesizes the narration chunk alone, as speech policy 6 does. */
async function synthesizeAlone(
  options: SynthesisOptions & { synthesize: SpeechSynthesizer },
  reason: OverlapAndCutFallbackReason,
): Promise<Uint8Array> {
  console.warn(
    JSON.stringify({
      event: "overlap-and-cut-fallback",
      conversionId: options.conversionId,
      sequence: options.sequence,
      synthesisAttempt: options.synthesisAttempt,
      reason,
    }),
  );

  return options.synthesize(options);
}

/**
 * Returns a text's last whole sentence, or the whole text when it is one sentence. Sentence
 * segmentation breaks after every line break, so the sentence never reaches back across a paragraph
 * break, such as the one between a heading and its narration block.
 *
 * Sentence segmentation also splits a trailing citation marker, footnote number, emoji or ellipsis
 * off as its own segment, sometimes mid-marker ("Schluss.[" and "6]"). Trailing segments without a
 * letter therefore stay attached to the sentence before them on the same line.
 */
export function selectLastSentence(text: string, narrationLanguage: string | undefined): string {
  const segmenter = new Intl.Segmenter(narrationLanguage, { granularity: "sentence" });
  const segments = [...segmenter.segment(text)].map(({ segment }) => segment);

  const sentenceSegments: string[] = [];
  for (const segment of segments.toReversed()) {
    const followingSegment = sentenceSegments[0];
    if (followingSegment === undefined) {
      if (segment.trim().length > 0) {
        sentenceSegments.unshift(segment);
      }
      continue;
    }

    if (LETTER_PATTERN.test(followingSegment) || LINE_END_PATTERN.test(segment)) {
      break;
    }
    sentenceSegments.unshift(segment);
  }

  if (sentenceSegments.length === 0) {
    throw new Error("Cannot overlap an empty previous narration chunk");
  }

  return sentenceSegments.join("").trim();
}

/** Encodes provider PCM as the MP3 frames speech recognition hears, without the encoder's tags. */
export async function encodeMp3Frames(pcm: Uint8Array): Promise<Uint8Array> {
  const encodedAudio = await encodePcmAsMp3(pcm, {
    bitrateKilobitsPerSecond: AUDIO_FORMAT.bitrateKilobitsPerSecond,
    sampleRate: AUDIO_FORMAT.sampleRate,
  });
  const { audioStart, audioEnd } = analyzeMp3(encodedAudio);

  return encodedAudio.subarray(audioStart, audioEnd);
}
