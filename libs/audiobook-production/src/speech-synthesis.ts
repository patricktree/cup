import type { SpeechConfig } from "#src/speech-synthesis-config.ts";

export const SPEECH_RECOGNITION_MODEL = "@cf/openai/whisper-large-v3-turbo";

/**
 * Minimal AI operations required for audio segment production: speech synthesis through the AI
 * gateway, and speech recognition as a Workers AI model run.
 */
export type SpeechSynthesisAi = {
  gateway(gatewayId: string): Pick<AiGateway, "run">;
  run: (
    model: typeof SPEECH_RECOGNITION_MODEL,
    inputs: Ai_Cf_Openai_Whisper_Large_V3_Turbo_Input,
    options: AiOptions & { returnRawResponse: true },
  ) => Promise<Response>;
};

export type NarrationSynthesisResponseMode = "streaming" | "non-streaming";

export type SpeechSynthesizer = (options: SynthesisOptions) => Promise<Uint8Array>;

/** One normalized text input for narration synthesis. */
export type NarrationChunk = {
  text: string;
  /**
   * Whether this chunk continues the narration block the chunk before it belongs to, as the later
   * chunks of an oversized narration block do; the manifest's synchronization unit records it.
   */
  continuesNarrationBlock?: boolean | undefined;
};

/** Identifies a provider failure that cannot succeed when repeated unchanged. */
export class PermanentNarrationSynthesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentNarrationSynthesisError";
  }
}

/** Identifies a provider rate limit, which clears only after its per-minute window passes. */
export class RateLimitedNarrationSynthesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedNarrationSynthesisError";
  }
}

export type SynthesisOptions = {
  ai: Pick<SpeechSynthesisAi, "gateway">;
  conversionId: string;
  narrationText: string;
  sequence: number;
  synthesisAttempt: number;
  synthesisResponseMode: NarrationSynthesisResponseMode;
  speechConfig: SpeechConfig;
  /** The manifest's canonical BCP 47 narration language, absent when the conversion has none. */
  narrationLanguage?: string | undefined;
};
