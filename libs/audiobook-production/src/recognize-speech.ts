import { z } from "zod";

import type { RecognizedWord } from "#src/find-cut-point.ts";
import {
  PermanentNarrationSynthesisError,
  RateLimitedNarrationSynthesisError,
  SPEECH_RECOGNITION_MODEL,
  type SpeechSynthesisAi,
} from "#src/speech-synthesis.ts";

export type RecognizeSpeechOptions = {
  ai: SpeechSynthesisAi;
  /** The provider audio before the narration pace stretch, as MP3 frames. */
  mp3: Uint8Array;
  /** Whisper's language code; undefined lets Whisper detect the language. */
  recognitionLanguage: string | undefined;
  conversionId: string;
  sequence: number;
  synthesisAttempt: number;
};

const RECOGNITION_GATEWAY_ID = "default";
const RECOGNITION_REQUEST_TIMEOUT_MILLISECONDS = 90_000;

const WHISPER_OUTPUT_SCHEMA = z.object({
  text: z.string(),
  segments: z
    .array(
      z.object({
        words: z
          .array(z.object({ word: z.string(), start: z.number(), end: z.number() }))
          .optional(),
      }),
    )
    .optional(),
});

/**
 * Runs speech recognition on the provider audio of an overlap take and returns the words it heard,
 * with their timings. Errors are classified as synthesis provider errors are: a rate limit raises
 * `RateLimitedNarrationSynthesisError`, a timeout or server error a plain retryable error, and
 * every other failure, an invalid response included, `PermanentNarrationSynthesisError`.
 */
export async function recognizeSpeech({
  ai,
  mp3,
  recognitionLanguage,
  conversionId,
  sequence,
  synthesisAttempt,
}: RecognizeSpeechOptions): Promise<RecognizedWord[]> {
  const response = await ai.run(
    SPEECH_RECOGNITION_MODEL,
    {
      audio: encodeBase64(mp3),
      ...(recognitionLanguage === undefined ? {} : { language: recognitionLanguage }),
    },
    {
      gateway: {
        collectLog: true,
        id: RECOGNITION_GATEWAY_ID,
        metadata: { conversionId, narrationSegmentSequence: sequence, synthesisAttempt },
        requestTimeoutMs: RECOGNITION_REQUEST_TIMEOUT_MILLISECONDS,
      },
      // The raw response keeps the HTTP status, which classifies a failure.
      returnRawResponse: true,
      signal: AbortSignal.timeout(RECOGNITION_REQUEST_TIMEOUT_MILLISECONDS),
    },
  );

  if (!response.ok) {
    const message = `Workers AI speech recognition failed with status ${response.status}: ${await readErrorMessage(response)}`;

    if (response.status === 429) {
      throw new RateLimitedNarrationSynthesisError(message);
    }

    if (response.status === 408 || response.status >= 500) {
      throw new Error(message);
    }

    throw new PermanentNarrationSynthesisError(message);
  }

  const output = WHISPER_OUTPUT_SCHEMA.safeParse(await response.json().catch(() => undefined));
  if (!output.success) {
    throw new PermanentNarrationSynthesisError(
      `Workers AI speech recognition returned an invalid response: ${z.prettifyError(output.error)}`,
    );
  }

  return (output.data.segments ?? []).flatMap(({ words = [] }) =>
    words.map(({ word, start, end }) => ({ word, startSeconds: start, endSeconds: end })),
  );
}

const ERROR_BODY_SCHEMA = z.union([
  z.object({ description: z.string().nonempty() }).transform(({ description }) => description),
  z
    .object({ errors: z.tuple([z.object({ message: z.string().nonempty() })], z.unknown()) })
    .transform(({ errors }) => errors[0].message),
]);

async function readErrorMessage(response: Response): Promise<string> {
  const body = (await response.text()).trim();

  try {
    const message = ERROR_BODY_SCHEMA.safeParse(JSON.parse(body));
    if (message.success) {
      return message.data;
    }
  } catch {
    // A body that is not JSON is reported as it is.
  }

  return body.length === 0 ? "The provider returned an error response" : body;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
