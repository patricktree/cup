import type { SpeechConfig } from "#src/speech-synthesis-config.ts";

/** Minimal AI gateway operations required for speech synthesis. */
export type SpeechSynthesisAi = {
  gateway(gatewayId: string): Pick<AiGateway, "run">;
};

export type NarrationSynthesisResponseMode = "streaming" | "non-streaming";

export type SpeechSynthesizer = (options: SynthesisOptions) => Promise<Uint8Array>;

/** One normalized text input for narration synthesis. */
export type NarrationChunk = {
  text: string;
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
  ai: SpeechSynthesisAi;
  conversionId: string;
  narrationText: string;
  sequence: number;
  synthesisAttempt: number;
  synthesisResponseMode: NarrationSynthesisResponseMode;
  speechConfig: SpeechConfig;
};
