import { AUDIO_FORMAT } from "#src/audio-format.ts";

/** A word that speech recognition heard in the provider audio, with its timing in seconds. */
export type RecognizedWord = {
  word: string;
  startSeconds: number;
  endSeconds: number;
};

export type FindCutPointOptions = {
  /**
   * The text spoken in the overlap take: the overlap sentence, the separator and the narration
   * chunk.
   */
  synthesizedText: string;
  /**
   * Index of the narration chunk's first word among the words of `synthesizedText`, as counted by
   * `countSynthesizedWords`.
   */
  chunkStartWordIndex: number;
  recognizedWords: readonly RecognizedWord[];
  /** The provider audio as 16-bit little-endian mono PCM in `AUDIO_FORMAT.sampleRate`. */
  providerPcm: Uint8Array;
};

/** What the cut check judged a cut point by. */
type CutCheckEvidence = {
  cutPointSeconds: number;
  /** Length of the silent run the cut point lies in; 0 when the search span has no silent frame. */
  silentRunMilliseconds: number;
  /**
   * Words between the last aligned word of the overlap sentence and the chunk start; undefined when
   * none is aligned.
   */
  overlapWordDistance: number | undefined;
  /**
   * Words between the chunk start and the first aligned word of the chunk; undefined when none is
   * aligned.
   */
  chunkWordDistance: number | undefined;
};

export type CutPointResult =
  | { isAccepted: true; cutPointSeconds: number; evidence: CutCheckEvidence }
  | { isAccepted: false; reason: "no-cut-point" }
  | { isAccepted: false; reason: "cut-check-failed"; evidence: CutCheckEvidence };

const FRAME_SAMPLE_COUNT = AUDIO_FORMAT.sampleRate / 100;
const FRAMES_PER_SECOND = 100;
const SILENCE_THRESHOLD_DBFS = -45;
const MIN_SILENT_RUN_MILLISECONDS = 150;
const MAX_ALIGNED_WORD_DISTANCE = 2;

/** Counts the words of a text the way `findCutPoint` aligns them, for its `chunkStartWordIndex`. */
export function countSynthesizedWords(text: string): number {
  return splitIntoNormalizedWords(text).length;
}

/**
 * Finds the cut point in an overlap take, where the narration chunk starts, and runs the cut check
 * on it.
 *
 * Aligns the synthesized text with the recognized words and cuts in the middle of the longest
 * silent run between the aligned words on either side of the chunk start. The cut check accepts the
 * cut point only when it lies between the last aligned word of the overlap sentence and the first
 * aligned word of the chunk, an aligned word lies at most two words from the chunk start on each
 * side, and the silent run lasts at least 150 ms. Exact edge words and chunk coverage are not
 * gated, since number, unit and name spellings would raise false alarms.
 */
export function findCutPoint({
  synthesizedText,
  chunkStartWordIndex,
  recognizedWords,
  providerPcm,
}: FindCutPointOptions): CutPointResult {
  const synthesizedWords = splitIntoNormalizedWords(synthesizedText);
  const alignedPairs = alignWords(
    synthesizedWords,
    recognizedWords.map(({ word }) => normalizeWord(word)),
  );

  if (alignedPairs.length === 0) {
    return { isAccepted: false, reason: "no-cut-point" };
  }

  const lastPairBeforeChunk = alignedPairs.findLast(
    ({ synthesizedIndex }) => synthesizedIndex < chunkStartWordIndex,
  );
  const firstPairOfChunk = alignedPairs.find(
    ({ synthesizedIndex }) => synthesizedIndex >= chunkStartWordIndex,
  );

  const frameLevels = measureFrameLevels(providerPcm);
  // Whisper stretches word ends over pauses, so the search starts where the overlap's last aligned
  // word starts, and it ends where the chunk's first aligned word starts: a cut after that word
  // would drop it, such as a one-word heading that opens the chunk.
  const spanStartSeconds = lastPairBeforeChunk
    ? recognizedWords[lastPairBeforeChunk.recognizedIndex]!.startSeconds
    : 0;
  const spanEndSeconds = firstPairOfChunk
    ? recognizedWords[firstPairOfChunk.recognizedIndex]!.startSeconds
    : frameLevels.length / FRAMES_PER_SECOND;

  const silentRun = findLongestSilentRun(
    frameLevels,
    Math.floor(spanStartSeconds * FRAMES_PER_SECOND),
    Math.min(frameLevels.length, Math.ceil(spanEndSeconds * FRAMES_PER_SECOND)),
  );
  const cutPointSeconds = silentRun
    ? (silentRun.startFrame + silentRun.endFrame) / 2 / FRAMES_PER_SECOND
    : (spanStartSeconds + spanEndSeconds) / 2;

  const evidence: CutCheckEvidence = {
    cutPointSeconds,
    silentRunMilliseconds: silentRun
      ? ((silentRun.endFrame - silentRun.startFrame) * 1000) / FRAMES_PER_SECOND
      : 0,
    overlapWordDistance: lastPairBeforeChunk
      ? chunkStartWordIndex - 1 - lastPairBeforeChunk.synthesizedIndex
      : undefined,
    chunkWordDistance: firstPairOfChunk
      ? firstPairOfChunk.synthesizedIndex - chunkStartWordIndex
      : undefined,
  };

  // Out-of-order word timings can leave the span empty, so the cut check tests that the cut point
  // lies between the edge words rather than assuming it.
  const isBetweenEdgeWords = spanStartSeconds < cutPointSeconds && cutPointSeconds < spanEndSeconds;
  const isAccepted =
    isBetweenEdgeWords &&
    evidence.overlapWordDistance !== undefined &&
    evidence.overlapWordDistance <= MAX_ALIGNED_WORD_DISTANCE &&
    evidence.chunkWordDistance !== undefined &&
    evidence.chunkWordDistance <= MAX_ALIGNED_WORD_DISTANCE &&
    evidence.silentRunMilliseconds >= MIN_SILENT_RUN_MILLISECONDS;

  return isAccepted
    ? { isAccepted: true, cutPointSeconds, evidence }
    : { isAccepted: false, reason: "cut-check-failed", evidence };
}

function splitIntoNormalizedWords(text: string): string[] {
  return text.split(/\s+/u).map(normalizeWord).filter(Boolean);
}

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^\p{L}\p{N}]/gu, "");
}

type AlignedPair = { synthesizedIndex: number; recognizedIndex: number };

/**
 * Aligns two word lists by their longest common subsequence. Synthesized words are never empty, so
 * a recognized word that normalizes to nothing, such as a dash, never aligns.
 */
function alignWords(
  synthesizedWords: readonly string[],
  recognizedWords: readonly string[],
): AlignedPair[] {
  const rowLength = recognizedWords.length + 1;
  // suffixLengths[i * rowLength + j] is the LCS length of synthesizedWords[i..] and recognizedWords[j..].
  const suffixLengths = new Int32Array((synthesizedWords.length + 1) * rowLength);

  for (let i = synthesizedWords.length - 1; i >= 0; i--) {
    for (let j = recognizedWords.length - 1; j >= 0; j--) {
      suffixLengths[i * rowLength + j] =
        synthesizedWords[i] === recognizedWords[j]
          ? suffixLengths[(i + 1) * rowLength + j + 1]! + 1
          : Math.max(
              suffixLengths[(i + 1) * rowLength + j]!,
              suffixLengths[i * rowLength + j + 1]!,
            );
    }
  }

  const alignedPairs: AlignedPair[] = [];
  let i = 0;
  let j = 0;

  while (i < synthesizedWords.length && j < recognizedWords.length) {
    if (synthesizedWords[i] === recognizedWords[j]) {
      alignedPairs.push({ synthesizedIndex: i, recognizedIndex: j });
      i++;
      j++;
    } else if (suffixLengths[(i + 1) * rowLength + j]! >= suffixLengths[i * rowLength + j + 1]!) {
      i++;
    } else {
      j++;
    }
  }

  return alignedPairs;
}

/** Measures the level of every 10 ms frame in dBFS. */
function measureFrameLevels(pcm: Uint8Array): Float64Array {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const frameLevels = new Float64Array(Math.floor(samples.length / FRAME_SAMPLE_COUNT));

  for (let frame = 0; frame < frameLevels.length; frame++) {
    let sumOfSquares = 0;

    for (
      let sample = frame * FRAME_SAMPLE_COUNT;
      sample < (frame + 1) * FRAME_SAMPLE_COUNT;
      sample++
    ) {
      sumOfSquares += (samples[sample]! / 32_768) ** 2;
    }

    // the offset keeps digital silence finite
    frameLevels[frame] = 10 * Math.log10(sumOfSquares / FRAME_SAMPLE_COUNT + 1e-12);
  }

  return frameLevels;
}

type SilentRun = { startFrame: number; endFrame: number };

function findLongestSilentRun(
  frameLevels: Float64Array,
  fromFrame: number,
  toFrame: number,
): SilentRun | undefined {
  let longestRun: SilentRun | undefined;
  let runStartFrame: number | undefined;

  for (let frame = fromFrame; frame <= toFrame; frame++) {
    const isSilent = frame < toFrame && frameLevels[frame]! <= SILENCE_THRESHOLD_DBFS;

    if (isSilent && runStartFrame === undefined) {
      runStartFrame = frame;
    } else if (!isSilent && runStartFrame !== undefined) {
      if (!longestRun || frame - runStartFrame > longestRun.endFrame - longestRun.startFrame) {
        longestRun = { startFrame: runStartFrame, endFrame: frame };
      }

      runStartFrame = undefined;
    }
  }

  return longestRun;
}
