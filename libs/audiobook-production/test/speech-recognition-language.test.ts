import { expect, test } from "vitest";

import { getSpeechRecognitionLanguage } from "#src/speech-recognition-language.ts";

test.each([
  ["de-AT", "de"],
  ["de", "de"],
  ["en-GB", "en"],
  ["fr", "fr"],
  ["yue-HK", "yue"],
  // Whisper still knows these languages by older codes.
  ["fil", "tl"],
  ["nb-NO", "no"],
  ["jv", "jw"],
] as const)(
  "speech recognition hears the narration language %s as %s",
  (narrationLanguage, recognitionLanguage) => {
    expect(getSpeechRecognitionLanguage(narrationLanguage)).toBe(recognitionLanguage);
  },
);

test.each(["rw", "rw-RW", "ckb", "sat", "pbt", "sv-SE"])(
  "speech recognition does not support the narration language %s",
  (narrationLanguage) => {
    expect(getSpeechRecognitionLanguage(narrationLanguage)).toBeUndefined();
  },
);
