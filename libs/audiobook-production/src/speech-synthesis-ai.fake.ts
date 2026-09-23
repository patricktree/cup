import { AUDIO_FORMAT } from "#src/audio-format.ts";
import type { SpeechSynthesisAi } from "#src/produce-audio-segment.ts";

const DEFAULT_DURATION_MILLISECONDS = 100;
const TONE_FREQUENCY_HERTZ = 440;
const TONE_AMPLITUDE = 8_000;

export type FakeSpeechSynthesisAiOptions = {
  failureStatus?: number;
  durationMilliseconds?: number;
};

/** Creates a deterministic speech adapter without an external AI binding. */
export function createFakeSpeechSynthesisAi(
  options: FakeSpeechSynthesisAiOptions = {},
): SpeechSynthesisAi {
  const run: AiGateway["run"] = async (request) => {
    if (options.failureStatus !== undefined) {
      return Response.json(
        { error: { message: "Configured deterministic speech failure" } },
        { status: options.failureStatus },
      );
    }

    const pcm = createTonePcm(options.durationMilliseconds ?? DEFAULT_DURATION_MILLISECONDS);

    if (!Array.isArray(request) && request.provider === "elevenlabs") {
      return new Response(pcm, { headers: { "Content-Type": "audio/pcm" } });
    }

    return Response.json({
      steps: [{ content: [createAudioContent(pcm)] }],
    });
  };

  return {
    gateway: () => ({ run }),
  };
}

function createTonePcm(durationMilliseconds: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(durationMilliseconds) || durationMilliseconds <= 0) {
    throw new Error("Fake speech duration must be a positive finite number");
  }

  const sampleCount = Math.max(
    1,
    Math.round((AUDIO_FORMAT.sampleRate * durationMilliseconds) / 1_000),
  );
  const pcm = new Uint8Array(sampleCount * 2);
  const view = new DataView(pcm.buffer);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(
      Math.sin((index / AUDIO_FORMAT.sampleRate) * TONE_FREQUENCY_HERTZ * Math.PI * 2) *
        TONE_AMPLITUDE,
    );
    view.setInt16(index * 2, sample, true);
  }

  return pcm;
}

function createAudioContent(audio: Uint8Array) {
  const binary = Array.from(audio, (byte) => String.fromCharCode(byte)).join("");

  return {
    type: "audio",
    data: btoa(binary),
    mime_type: `audio/l16;rate=${AUDIO_FORMAT.sampleRate}`,
    sample_rate: AUDIO_FORMAT.sampleRate,
    channels: AUDIO_FORMAT.channelCount,
  } as const;
}
