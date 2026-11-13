import { expect, test } from "vitest";

import { getSpeechRecognitionLanguage } from "#src/speech-recognition-language.ts";

/**
 * The keys of `LANGUAGES` in Whisper's tokenizer.
 * https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/tokenizer.py
 */
const WHISPER_TOKENIZER_LANGUAGE_CODES = [
  "en",
  "zh",
  "de",
  "es",
  "ru",
  "ko",
  "fr",
  "ja",
  "pt",
  "tr",
  "pl",
  "ca",
  "nl",
  "ar",
  "sv",
  "it",
  "id",
  "hi",
  "fi",
  "vi",
  "he",
  "uk",
  "el",
  "ms",
  "cs",
  "ro",
  "da",
  "hu",
  "ta",
  "no",
  "th",
  "ur",
  "hr",
  "bg",
  "lt",
  "la",
  "mi",
  "ml",
  "cy",
  "sk",
  "te",
  "fa",
  "lv",
  "bn",
  "sr",
  "az",
  "sl",
  "kn",
  "et",
  "mk",
  "br",
  "eu",
  "is",
  "hy",
  "ne",
  "mn",
  "bs",
  "kk",
  "sq",
  "sw",
  "gl",
  "mr",
  "pa",
  "si",
  "km",
  "sn",
  "yo",
  "so",
  "af",
  "oc",
  "ka",
  "be",
  "tg",
  "sd",
  "gu",
  "am",
  "yi",
  "lo",
  "uz",
  "fo",
  "ht",
  "ps",
  "tk",
  "nn",
  "mt",
  "sa",
  "lb",
  "my",
  "bo",
  "tl",
  "mg",
  "as",
  "tt",
  "haw",
  "ln",
  "ha",
  "ba",
  "jw",
  "su",
  "yue",
];

test.each([
  ["de-AT", "de"],
  ["de", "de"],
  ["en-GB", "en"],
  ["fr", "fr"],
  ["yue-HK", "yue"],
  // Gemini's speech model gets no language tag for these, but Whisper still hears them.
  ["sv-SE", "sv"],
  ["fi", "fi"],
  ["uk", "uk"],
  ["haw", "haw"],
  ["sn", "sn"],
  // Whisper still knows these languages by older codes.
  ["fil", "tl"],
  ["tl", "tl"],
  ["nb-NO", "no"],
  ["no", "no"],
  ["jv", "jw"],
  ["jw", "jw"],
  // `Intl` canonicalizes deprecated codes and individual languages to Whisper's codes.
  ["iw", "he"],
  ["mo", "ro"],
  ["cmn", "zh"],
  ["lvs", "lv"],
  // Southern Pashto is written in the same script and standard as Whisper's Pashto.
  ["pbt", "ps"],
] as const)(
  "speech recognition hears the narration language %s as %s",
  (narrationLanguage, recognitionLanguage) => {
    expect(getSpeechRecognitionLanguage(narrationLanguage)).toBe(recognitionLanguage);
  },
);

test.each(["rw", "rw-RW", "ckb", "sat", "zu-ZA", "arz", "azb"])(
  "speech recognition does not support the narration language %s",
  (narrationLanguage) => {
    expect(getSpeechRecognitionLanguage(narrationLanguage)).toBeUndefined();
  },
);

test("speech recognition supports each of Whisper's 100 languages", () => {
  const whisperLanguageCodes = new Set(
    WHISPER_TOKENIZER_LANGUAGE_CODES.map((code) => getSpeechRecognitionLanguage(code)),
  );

  expect(whisperLanguageCodes).toEqual(new Set(WHISPER_TOKENIZER_LANGUAGE_CODES));
});
