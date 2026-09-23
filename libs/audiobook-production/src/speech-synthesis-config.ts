export type SpeechConfig = {
  provider: "google-ai-studio" | "elevenlabs";
  model: string;
  voice: string;
  policyVersion: string;
};

export const GEMINI_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.1-flash-tts-preview",
  voice: "Charon",
  policyVersion: "3",
} as const satisfies SpeechConfig;

export const ELEVENLABS_SPEECH_CONFIG = {
  provider: "elevenlabs",
  model: "eleven_v3",
  // George, a stock narration voice used in the provider's API examples.
  voice: "JBFqnCBsd6RMkjVDRZzb",
  policyVersion: "1",
} as const satisfies SpeechConfig;

/** Change this assignment and redeploy to switch the backend provider. */
export const SPEECH_CONFIG: SpeechConfig = { ...ELEVENLABS_SPEECH_CONFIG };
