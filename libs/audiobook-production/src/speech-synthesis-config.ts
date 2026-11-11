export type SpeechConfig = {
  provider: "google-ai-studio" | "elevenlabs";
  model: string;
  voice: string;
  policyVersion: string;
};

/**
 * Policy 6 sends the same request as policy 5 and time-stretches the provider audio by
 * `POLICY_6_SPEED_FACTOR` before encoding.
 */
export const GEMINI_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Charon",
  policyVersion: "6",
} as const satisfies SpeechConfig;

// Resumed conversions retain the model, request policy and pace they started with: policy 5 sends
// the narration language, when the model can speak it, and stores the provider audio unstretched;
// policy 4 sends no narration language, and policy 3 also wraps the text in a transcript
// instruction.
export const LEGACY_GEMINI_V5_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Charon",
  policyVersion: "5",
} as const satisfies SpeechConfig;

export const LEGACY_GEMINI_V4_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Charon",
  policyVersion: "4",
} as const satisfies SpeechConfig;

export const LEGACY_GEMINI_V3_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.1-flash-tts-preview",
  voice: "Charon",
  policyVersion: "3",
} as const satisfies SpeechConfig;

export const ELEVENLABS_SPEECH_CONFIG = {
  provider: "elevenlabs",
  model: "eleven_v3",
  // Lawrence — Bright and Informative.
  voice: "ktkP7Nsj67dw2zcplQYt",
  policyVersion: "1",
} as const satisfies SpeechConfig;

/** Every speech configuration a stored audiobook manifest or audio segment may record. */
export const KNOWN_SPEECH_CONFIGS = [
  GEMINI_SPEECH_CONFIG,
  LEGACY_GEMINI_V5_SPEECH_CONFIG,
  LEGACY_GEMINI_V4_SPEECH_CONFIG,
  LEGACY_GEMINI_V3_SPEECH_CONFIG,
  ELEVENLABS_SPEECH_CONFIG,
] as const satisfies readonly SpeechConfig[];

/**
 * Tells whether two speech configurations are the same by every field, as audio segment reuse
 * compares them.
 */
export function isSameSpeechConfig(left: SpeechConfig, right: SpeechConfig): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.voice === right.voice &&
    left.policyVersion === right.policyVersion
  );
}

// Picked by ear from Sonic renders between 1.05 and 1.20 (patricktree/cup#266).
const POLICY_6_SPEED_FACTOR = 1.05;

/**
 * Returns the factor by which a speech configuration speeds up the provider audio before encoding.
 * The factor follows from the policy rather than a configuration field, so a stored manifest or
 * segment needs no further metadata to tell its pace: policy 6 speeds up, every other policy keeps
 * the provider audio unstretched.
 */
export function getSpeedFactor(speechConfig: SpeechConfig): number {
  return isSameSpeechConfig(speechConfig, GEMINI_SPEECH_CONFIG) ? POLICY_6_SPEED_FACTOR : 1;
}

/** Change this assignment and redeploy to switch the backend provider. */
export const SPEECH_CONFIG: SpeechConfig = { ...GEMINI_SPEECH_CONFIG };
