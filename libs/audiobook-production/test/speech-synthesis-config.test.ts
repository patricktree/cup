import { expect, test } from "vitest";

import {
  ELEVENLABS_SPEECH_CONFIG,
  getSpeechPolicyTraits,
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

test("Gemini policy 7 is a known speech configuration that speeds up by 1.05 and overlaps and cuts", () => {
  expect(KNOWN_SPEECH_CONFIGS).toContainEqual(GEMINI_POLICY_7_SPEECH_CONFIG);
  expect(getSpeechPolicyTraits(GEMINI_POLICY_7_SPEECH_CONFIG)).toEqual({
    narrationPace: 1.05,
    isOverlapAndCut: true,
  });
});

test("Gemini policy 6 is a known speech configuration that speeds up by 1.05 without overlap and cut", () => {
  expect(KNOWN_SPEECH_CONFIGS).toContainEqual(GEMINI_POLICY_6_SPEECH_CONFIG);
  expect(getSpeechPolicyTraits(GEMINI_POLICY_6_SPEECH_CONFIG)).toEqual({
    narrationPace: 1.05,
    isOverlapAndCut: false,
  });
});

test.each([
  ["Gemini policy 5", LEGACY_GEMINI_V5_SPEECH_CONFIG],
  ["Gemini policy 4", LEGACY_GEMINI_V4_SPEECH_CONFIG],
  ["Gemini policy 3", LEGACY_GEMINI_V3_SPEECH_CONFIG],
  ["ElevenLabs policy 1", ELEVENLABS_SPEECH_CONFIG],
] as const)(
  "a %s configuration keeps the provider audio unstretched, without overlap and cut",
  (_, speechConfig) => {
    expect(getSpeechPolicyTraits(speechConfig)).toEqual({
      narrationPace: 1,
      isOverlapAndCut: false,
    });
  },
);
