import { expect, test } from "vitest";

import { countSynthesizedWords, findCutPoint, type RecognizedWord } from "#src/find-cut-point.ts";

const SAMPLE_RATE = 24_000;

test("cuts in the middle of a clean pause between the overlap sentence and the narration chunk", () => {
  const overlapSentence = "The first part ends here.";
  const narrationChunk = "Then the chunk begins.";
  const recognizedWords = [
    word("The", 0, 0.2),
    word("first", 0.3, 0.6),
    word("part", 0.7, 0.9),
    word("ends", 1, 1.2),
    word("here.", 1.3, 1.6),
    word("Then", 2.4, 2.6),
    word("the", 2.7, 2.8),
    word("chunk", 2.9, 3.2),
    word("begins.", 3.3, 3.8),
  ];

  const result = findCutPoint({
    synthesizedText: `${overlapSentence}\n\n${narrationChunk}`,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 4),
  });

  expect(result).toMatchObject({ isAccepted: true, cutPointSeconds: 2 });
});

test("cuts in the right pause when Whisper spells a number, unit or name differently from the text", () => {
  const overlapSentence = "The trail is 12 km long.";
  const recognizedWords = [
    word("The", 0, 0.2),
    word("trail", 0.3, 0.6),
    word("is", 0.7, 0.8),
    word("twelve", 0.9, 1.2),
    word("kilometers", 1.3, 1.8),
    word("long.", 1.9, 2.2),
    word("Doctor", 3, 3.3),
    word("Mueller", 3.4, 3.8),
    word("ran", 3.9, 4.1),
    word("it", 4.2, 4.3),
    word("in", 4.4, 4.5),
    word("two", 4.6, 4.8),
    word("hours.", 4.9, 5.3),
  ];

  const result = findCutPoint({
    synthesizedText: `${overlapSentence}\n\nDr. Müller ran it in 2 hours.`,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 5.5),
  });

  expect(result).toMatchObject({ isAccepted: true, cutPointSeconds: 2.6 });
});

test("cuts in the right pause when Whisper misses the chunk's first word", () => {
  const overlapSentence = "The first part ends here.";
  const spokenWords = [
    word("The", 0, 0.2),
    word("first", 0.3, 0.6),
    word("part", 0.7, 0.9),
    word("ends", 1, 1.2),
    word("here.", 1.3, 1.6),
    word("Then", 2.4, 2.6),
    word("the", 2.7, 2.8),
    word("chunk", 2.9, 3.2),
    word("begins.", 3.3, 3.8),
  ];

  const result = findCutPoint({
    synthesizedText: `${overlapSentence}\n\nThen the chunk begins.`,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords: spokenWords.filter((spokenWord) => spokenWord.word !== "Then"),
    providerPcm: createSpeechPcm(spokenWords, 4),
  });

  expect(result).toMatchObject({ isAccepted: true, cutPointSeconds: 2 });
});

test("cuts in the right pause when Whisper hears an extra word at the chunk start", () => {
  const overlapSentence = "The first part ends here.";
  const spokenWords = [
    word("The", 0, 0.2),
    word("first", 0.3, 0.6),
    word("part", 0.7, 0.9),
    word("ends", 1, 1.2),
    word("here.", 1.3, 1.6),
    word("Then", 2.4, 2.6),
    word("the", 2.7, 2.8),
    word("chunk", 2.9, 3.2),
    word("begins.", 3.3, 3.8),
  ];
  const recognizedWords = spokenWords.toSpliced(5, 0, word("So", 2.3, 2.4));

  const result = findCutPoint({
    synthesizedText: `${overlapSentence}\n\nThen the chunk begins.`,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords,
    providerPcm: createSpeechPcm(spokenWords, 4),
  });

  expect(result).toMatchObject({ isAccepted: true, cutPointSeconds: 2 });
});

test("cuts in the silent run when Whisper stretches the overlap's last word over the pause", () => {
  const overlapSentence = "The first part ends here.";
  const spokenWords = [
    word("The", 0, 0.2),
    word("first", 0.3, 0.6),
    word("part", 0.7, 0.9),
    word("ends", 1, 1.2),
    word("here.", 1.3, 1.6),
    word("Then", 2.4, 2.6),
    word("the", 2.7, 2.8),
    word("chunk", 2.9, 3.2),
    word("begins.", 3.3, 3.8),
  ];
  const recognizedWords = spokenWords.with(4, word("here.", 1.3, 2.35));

  const result = findCutPoint({
    synthesizedText: `${overlapSentence}\n\nThen the chunk begins.`,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords,
    providerPcm: createSpeechPcm(spokenWords, 4),
  });

  expect(result).toMatchObject({
    isAccepted: true,
    cutPointSeconds: 2,
    evidence: { silentRunMilliseconds: 800 },
  });
});

test("cuts after a one-word heading spoken as the overlap", () => {
  const recognizedWords = [
    word("Results", 0, 0.6),
    word("The", 1.4, 1.6),
    word("chunk", 1.7, 2),
    word("begins.", 2.1, 2.6),
  ];

  const result = findCutPoint({
    synthesizedText: "Results\n\nThe chunk begins.",
    chunkStartWordIndex: countSynthesizedWords("Results"),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 3),
  });

  expect(result).toMatchObject({ isAccepted: true, cutPointSeconds: 1 });
});

test("fails with no-cut-point when no recognized word aligns with the synthesized text", () => {
  const overlapSentence = "The first part ends here.";
  const recognizedWords = [word("Something", 0, 0.5), word("else", 1.5, 2)];

  const result = findCutPoint({
    synthesizedText: `${overlapSentence}\n\nThen the chunk begins.`,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 3),
  });

  expect(result).toEqual({ isAccepted: false, reason: "no-cut-point" });
});

test("fails the cut check when the longest silent run at the chunk start is shorter than 150 ms", () => {
  const overlapSentence = "The first part ends here.";
  const recognizedWords = [
    word("The", 0, 0.2),
    word("first", 0.3, 0.6),
    word("part", 0.7, 0.9),
    word("ends", 1, 1.2),
    word("here.", 1.3, 1.6),
    word("Then", 1.74, 2),
    word("the", 2.1, 2.2),
    word("chunk", 2.3, 2.6),
    word("begins.", 2.7, 3.2),
  ];

  const result = findCutPoint({
    synthesizedText: `${overlapSentence}\n\nThen the chunk begins.`,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 3.5),
  });

  expect(result).toMatchObject({
    isAccepted: false,
    reason: "cut-check-failed",
    evidence: { silentRunMilliseconds: 140 },
  });
});

test("fails the cut check when no aligned word lies within two words of the chunk start", () => {
  const overlapSentence = "One two three four five six.";
  // Whisper misheard the three words on either side of the chunk start.
  const recognizedWords = [
    word("One", 0, 0.2),
    word("two", 0.3, 0.5),
    word("three", 0.6, 0.8),
    word("for", 0.9, 1.1),
    word("fife", 1.2, 1.4),
    word("sex", 1.5, 1.7),
    word("Siven", 2.5, 2.7),
    word("ate", 2.8, 3),
    word("nein", 3.1, 3.3),
    word("ten", 3.4, 3.6),
    word("eleven.", 3.7, 4),
  ];

  const result = findCutPoint({
    synthesizedText: `${overlapSentence}\n\nSeven eight nine ten eleven.`,
    chunkStartWordIndex: countSynthesizedWords(overlapSentence),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 4.5),
  });

  expect(result).toMatchObject({
    isAccepted: false,
    reason: "cut-check-failed",
    evidence: { overlapWordDistance: 3, chunkWordDistance: 3 },
  });
});

test("fails the cut check when no word of the overlap sentence is aligned", () => {
  const recognizedWords = [
    word("Resorts", 0, 0.6),
    word("The", 1.4, 1.6),
    word("chunk", 1.7, 2),
    word("begins.", 2.1, 2.6),
  ];

  const result = findCutPoint({
    synthesizedText: "Results\n\nThe chunk begins.",
    chunkStartWordIndex: countSynthesizedWords("Results"),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 3),
  });

  expect(result).toMatchObject({
    isAccepted: false,
    reason: "cut-check-failed",
    evidence: { overlapWordDistance: undefined, chunkWordDistance: 0 },
  });
});

test("fails the cut check when no word of the narration chunk is aligned", () => {
  const recognizedWords = [word("Results", 0, 0.6), word("Thanks", 1.4, 2)];

  const result = findCutPoint({
    synthesizedText: "Results\n\nThe end.",
    chunkStartWordIndex: countSynthesizedWords("Results"),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 2.5),
  });

  expect(result).toMatchObject({
    isAccepted: false,
    reason: "cut-check-failed",
    evidence: { overlapWordDistance: 0, chunkWordDistance: undefined },
  });
});

test("fails the cut check when the overlap runs into the chunk without any silence", () => {
  const recognizedWords = [word("Results", 0, 0.6), word("matter.", 0.6, 1.2)];

  const result = findCutPoint({
    synthesizedText: "Results\n\nmatter.",
    chunkStartWordIndex: countSynthesizedWords("Results"),
    recognizedWords,
    providerPcm: createSpeechPcm(recognizedWords, 1.2),
  });

  expect(result).toEqual({
    isAccepted: false,
    reason: "cut-check-failed",
    evidence: {
      cutPointSeconds: 0.6,
      silentRunMilliseconds: 0,
      overlapWordDistance: 0,
      chunkWordDistance: 0,
    },
  });
});

function word(text: string, startSeconds: number, endSeconds: number): RecognizedWord {
  return { word: text, startSeconds, endSeconds };
}

/**
 * Creates 16-bit mono PCM with a tone wherever a word is spoken and digital silence elsewhere.
 * Tests pass the recognized words as `speechSpans` unless Whisper's words differ from the audio.
 */
function createSpeechPcm(
  speechSpans: readonly { startSeconds: number; endSeconds: number }[],
  durationSeconds: number,
): Uint8Array {
  const samples = new Int16Array(Math.round(durationSeconds * SAMPLE_RATE));

  for (const { startSeconds, endSeconds } of speechSpans) {
    const firstSample = Math.round(startSeconds * SAMPLE_RATE);
    const lastSample = Math.min(samples.length, Math.round(endSeconds * SAMPLE_RATE));

    for (let sample = firstSample; sample < lastSample; sample++) {
      samples[sample] = Math.round(10_000 * Math.sin((2 * Math.PI * 220 * sample) / SAMPLE_RATE));
    }
  }

  return new Uint8Array(samples.buffer);
}
