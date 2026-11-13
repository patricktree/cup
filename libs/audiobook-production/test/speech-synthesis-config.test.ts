import { expect, test } from "vitest";

import {
  ELEVENLABS_SPEECH_CONFIG,
  getSpeedFactor,
  KNOWN_SPEECH_CONFIGS,
  LEGACY_GEMINI_V3_SPEECH_CONFIG,
  LEGACY_GEMINI_V4_SPEECH_CONFIG,
  LEGACY_GEMINI_V5_SPEECH_CONFIG,
  SPEECH_CONFIG,
} from "#src/speech-synthesis-config.ts";

// Both spelled out rather than taken from the module, whose names move on to the next policy when it
// becomes the deployment configuration, while stored manifests must keep their policy and pace.
const GEMINI_POLICY_7_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Charon",
  policyVersion: "7",
} as const;

const GEMINI_POLICY_6_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Charon",
  policyVersion: "6",
} as const;

test("the deployment speech configuration is Gemini policy 7", () => {
  expect(SPEECH_CONFIG).toEqual(GEMINI_POLICY_7_SPEECH_CONFIG);
});

test.each([
  ["Gemini policy 7", GEMINI_POLICY_7_SPEECH_CONFIG],
  ["Gemini policy 6", GEMINI_POLICY_6_SPEECH_CONFIG],
] as const)("%s is a known speech configuration that speeds up by 1.05", (_, speechConfig) => {
  expect(KNOWN_SPEECH_CONFIGS).toContainEqual(speechConfig);
  expect(getSpeedFactor(speechConfig)).toBe(1.05);
});

test.each([
  ["Gemini policy 5", LEGACY_GEMINI_V5_SPEECH_CONFIG],
  ["Gemini policy 4", LEGACY_GEMINI_V4_SPEECH_CONFIG],
  ["Gemini policy 3", LEGACY_GEMINI_V3_SPEECH_CONFIG],
  ["ElevenLabs policy 1", ELEVENLABS_SPEECH_CONFIG],
] as const)("a %s configuration keeps the provider audio unstretched", (_, speechConfig) => {
  expect(getSpeedFactor(speechConfig)).toBe(1);
});
