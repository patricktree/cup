import { expect, test } from "vitest";

import { GEMINI_SPEECH_CONFIG } from "#src/speech-synthesis-config.ts";
import { PermanentNarrationSynthesisError, type SynthesisOptions } from "#src/speech-synthesis.ts";
import { synthesizeGeminiAudio } from "#src/synthesize-gemini-audio.ts";

const RESPONSE_MODES = ["streaming", "non-streaming"] as const;
const INVALID_METADATA = [
  { channels: 2 },
  { channels: -1 },
  { sample_rate: 44_100 },
  { sample_rate: "24000" },
  { mime_type: "audio/wav" },
  { mime_type: "audio/l16;rate=44100" },
];

test.each(
  RESPONSE_MODES.flatMap((mode) => INVALID_METADATA.map((metadata) => ({ mode, metadata }))),
)(
  "rejects incompatible audio metadata permanently in $mode: $metadata",
  async ({ mode, metadata }) => {
    await expect(synthesizeGeminiAudio(createOptions(mode, metadata))).rejects.toBeInstanceOf(
      PermanentNarrationSynthesisError,
    );
  },
);

test.each(
  RESPONSE_MODES.flatMap((mode) =>
    ["audio/l16", " AUDIO/L16 ; RATE=24000"].map((mime_type) => ({ mode, mime_type })),
  ),
)(
  "accepts compatible MIME types and omitted numeric metadata in $mode: $mime_type",
  async ({ mode, mime_type }) => {
    await expect(synthesizeGeminiAudio(createOptions(mode, { mime_type }))).resolves.toEqual(
      new Uint8Array([1, 2]),
    );
  },
);

test("accepts streaming audio deltas without repeated format metadata", async () => {
  await expect(
    synthesizeGeminiAudio(createOptions("streaming", { mime_type: undefined })),
  ).resolves.toEqual(new Uint8Array([1, 2]));
});

function createOptions(
  synthesisResponseMode: SynthesisOptions["synthesisResponseMode"],
  metadata: Record<string, unknown>,
): SynthesisOptions {
  const audio = { type: "audio", data: "AQI=", mime_type: "audio/l16;rate=24000", ...metadata };
  return {
    ai: {
      gateway: () => ({
        run: async () =>
          synthesisResponseMode === "streaming"
            ? new Response(
                `data: ${JSON.stringify({ event_type: "step.delta", delta: audio })}\n\ndata: [DONE]\n\n`,
                { headers: { "Content-Type": "text/event-stream" } },
              )
            : Response.json({ steps: [{ content: [audio] }] }),
      }),
    },
    conversionId: "audio-format-test",
    narrationText: "Narration",
    sequence: 0,
    synthesisAttempt: 1,
    synthesisResponseMode,
    speechConfig: GEMINI_SPEECH_CONFIG,
  };
}
