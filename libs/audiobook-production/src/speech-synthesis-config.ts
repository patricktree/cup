export type SpeechConfig = {
  provider: "google-ai-studio" | "elevenlabs";
  model: string;
  voice: string;
  policyVersion: string;
};

/**
 * Speech policy 7 sends policy 6's request, except that every audio segment after the first speaks
 * the previous narration chunk's last whole sentence in front of its own narration chunk, and cuts
 * that overlap away at the cut point speech recognition finds (overlap and cut, see
 * `produceAudioSegment`). It keeps policy 6's narration pace, `POLICY_6_NARRATION_PACE` (see
 * `getSpeechPolicyTraits`).
 */
export const GEMINI_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Charon",
  policyVersion: "7",
} as const satisfies SpeechConfig;

// Resumed conversions retain the model, speech policy and narration pace they started with, so their
// retried segments sound like the rest. Policy 6 sends policy 7's request without overlap and cut,
// at the same narration pace; policy 5 sends the narration language, when the model can speak it,
// and stores the provider audio unstretched; policy 4 sends no narration language, and policy 3
// also wraps the text in a transcript instruction.
export const LEGACY_GEMINI_V6_SPEECH_CONFIG = {
  provider: "google-ai-studio",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Charon",
  policyVersion: "6",
} as const satisfies SpeechConfig;

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
  LEGACY_GEMINI_V6_SPEECH_CONFIG,
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

/** What a speech policy does to the provider audio, beyond the request it sends. */
type SpeechPolicyTraits = {
  /** The factor by which the provider audio is sped up before encoding; 1 keeps it unstretched. */
  narrationPace: number;
  /** Whether every audio segment after the first is produced with overlap and cut. */
  isOverlapAndCut: boolean;
};

// Picked by ear from Sonic renders between 1.05 and 1.20 (patricktree/cup#266).
const POLICY_6_NARRATION_PACE = 1.05;

const PROVIDER_AUDIO_AS_IS = {
  narrationPace: 1,
  isOverlapAndCut: false,
} as const satisfies SpeechPolicyTraits;

/**
 * Speech policy traits by provider and policy version; a policy not listed keeps the provider audio
 * as it is. They follow from the policy rather than a configuration field, so a stored manifest or
 * segment needs no further metadata to tell its narration pace, and they are keyed by the policy
 * rather than by `GEMINI_SPEECH_CONFIG`, so manifests keep their traits after a later policy
 * becomes the deployment configuration.
 */
const SPEECH_POLICY_TRAITS_BY_PROVIDER = {
  "google-ai-studio": {
    "6": { narrationPace: POLICY_6_NARRATION_PACE, isOverlapAndCut: false },
    "7": { narrationPace: POLICY_6_NARRATION_PACE, isOverlapAndCut: true },
  },
  elevenlabs: {},
} as const satisfies {
  [provider in SpeechConfig["provider"]]: Readonly<Record<string, SpeechPolicyTraits>>;
};

/** Returns the traits of a speech configuration's speech policy. */
export function getSpeechPolicyTraits(speechConfig: SpeechConfig): SpeechPolicyTraits {
  const traitsByPolicyVersion: Readonly<Partial<Record<string, SpeechPolicyTraits>>> =
    SPEECH_POLICY_TRAITS_BY_PROVIDER[speechConfig.provider];

  return traitsByPolicyVersion[speechConfig.policyVersion] ?? PROVIDER_AUDIO_AS_IS;
}

/**
 * Change this assignment and redeploy to switch the backend provider or speech policy, such as back
 * to `LEGACY_GEMINI_V6_SPEECH_CONFIG`. Conversions keep the speech configuration they were prepared
 * with.
 */
export const SPEECH_CONFIG: SpeechConfig = { ...GEMINI_SPEECH_CONFIG };
