import { expect, test } from "vitest";

import { recognizeSpeech } from "#src/recognize-speech.ts";
import type { SpeechSynthesisAi } from "#src/speech-synthesis.ts";

test("joins the pieces Whisper splits a number or a compound into, so each aligns as the word it is", async () => {
  // Real Whisper output: a piece without leading whitespace that opens with punctuation continues
  // the word before it.
  const whisperWords = [
    { word: " 1", start: 2.82, end: 3.52 },
    { word: ",173", start: 3.52, end: 5.46 },
    { word: " milliseconds,", start: 5.46, end: 6.04 },
    { word: " EU", start: 6.1, end: 6.4 },
    { word: "-Agrarpolitik", start: 6.4, end: 7.4 },
    { word: " «", start: 7.5, end: 7.6 },
    { word: " d", start: 7.6, end: 7.7 },
    { word: "'une", start: 7.7, end: 7.9 },
  ];

  const recognizedWords = await recognizeSpeech({
    ai: createWhisperAi(whisperWords),
    mp3: new Uint8Array([1, 2, 3]),
    recognitionLanguage: "en",
    conversionId: "conversion-id",
    sequence: 1,
    synthesisAttempt: 1,
  });

  expect(recognizedWords).toEqual([
    { word: " 1,173", startSeconds: 2.82, endSeconds: 5.46 },
    { word: " milliseconds,", startSeconds: 5.46, endSeconds: 6.04 },
    { word: " EU-Agrarpolitik", startSeconds: 6.1, endSeconds: 7.4 },
    { word: " «", startSeconds: 7.5, endSeconds: 7.6 },
    { word: " d'une", startSeconds: 7.6, endSeconds: 7.9 },
  ]);
});

function createWhisperAi(words: readonly { word: string; start: number; end: number }[]) {
  const ai: SpeechSynthesisAi = {
    gateway: () => {
      throw new Error("Speech recognition does not use the gateway binding");
    },
    run: async () =>
      Response.json({ text: words.map(({ word }) => word).join(""), segments: [{ words }] }),
  };

  return ai;
}
