import { expect, test } from "vitest";

import { getNarrationLanguageSupport } from "#src/narration-language-speakability.ts";
import {
  ELEVENLABS_SPEECH_CONFIG,
  GEMINI_SPEECH_CONFIG,
  SPEECH_CONFIG,
} from "#src/speech-synthesis-config.ts";

test.each([
  ["de-AT", "speakable"],
  ["fil", "speakable"],
  ["sv-SE", "unspeakable"],
] as const)("Gemini speech policy 5 finds %s %s", (narrationLanguage, support) => {
  expect(getNarrationLanguageSupport(narrationLanguage, GEMINI_SPEECH_CONFIG)).toBe(support);
});

test("ElevenLabs ignores the narration language, so no language is unspeakable there", () => {
  expect(getNarrationLanguageSupport("sv-SE", ELEVENLABS_SPEECH_CONFIG)).toBe("ignored");
});

test("the deployed speech configuration has registered languages", () => {
  expect(() => getNarrationLanguageSupport("de", SPEECH_CONFIG)).not.toThrow();
});

test("a Gemini model without registered languages fails loudly", () => {
  expect(() =>
    getNarrationLanguageSupport("de", { ...GEMINI_SPEECH_CONFIG, model: "gemini-9-tts" }),
  ).toThrow("No speakable languages are registered for the Gemini speech model gemini-9-tts");
});
