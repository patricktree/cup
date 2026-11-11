import { expect, test } from "vitest";

import {
  ELEVENLABS_SPEECH_CONFIG,
  getSpeedFactor,
  LEGACY_GEMINI_V3_SPEECH_CONFIG,
  LEGACY_GEMINI_V4_SPEECH_CONFIG,
  LEGACY_GEMINI_V5_SPEECH_CONFIG,
} from "#src/speech-synthesis-config.ts";

// Spelled out rather than taken from GEMINI_SPEECH_CONFIG, which a later policy replaces while
// policy 6 manifests must keep their pace.
const GEMINI_POLICY_6_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Charon",
  policyVersion: "6",
} as const;

test("a Gemini policy 6 configuration speeds up by 1.05", () => {
  expect(getSpeedFactor(GEMINI_POLICY_6_SPEECH_CONFIG)).toBe(1.05);
});

test.each([
  ["Gemini policy 5", LEGACY_GEMINI_V5_SPEECH_CONFIG],
  ["Gemini policy 4", LEGACY_GEMINI_V4_SPEECH_CONFIG],
  ["Gemini policy 3", LEGACY_GEMINI_V3_SPEECH_CONFIG],
  ["ElevenLabs policy 1", ELEVENLABS_SPEECH_CONFIG],
] as const)("a %s configuration keeps the provider audio unstretched", (_, speechConfig) => {
  expect(getSpeedFactor(speechConfig)).toBe(1);
});
