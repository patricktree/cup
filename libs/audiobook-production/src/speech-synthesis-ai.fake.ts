import { AUDIO_FORMAT } from "#src/audio-format.ts";
import type { SpeechSynthesisAi } from "#src/produce-audio-segment.ts";

const WORD_DURATION_MILLISECONDS = 200;
const WORD_GAP_MILLISECONDS = 50;
// Longer than the cut check's 150 ms silent run, so an overlap take has a pause to cut in.
const PAUSE_MILLISECONDS = 400;
const TONE_FREQUENCY_HERTZ = 440;
const TONE_AMPLITUDE = 8_000;

export type FakeSpeechSynthesisAiOptions = {
  failureStatus?: number;
  recognitionFailureStatus?: number;
  /**
   * Synthesizes one continuous tone of this duration instead of a tone burst per word; speech
   * recognition then hears no words in it.
   */
  durationMilliseconds?: number;
};

type FakeWord = { word: string; start: number; end: number };

/**
 * Creates a deterministic speech adapter without an external AI binding. Synthesis speaks every
 * word as a tone burst, separated by a short gap, and pauses after a sentence or line. Speech
 * recognition returns the word timings of the latest synthesis with the same gateway metadata.
 */
export function createFakeSpeechSynthesisAi(
  options: FakeSpeechSynthesisAiOptions = {},
): SpeechSynthesisAi {
  const synthesizedWordsByMetadata = new Map<string, FakeWord[]>();

  const gatewayRun: AiGateway["run"] = async (request, runOptions) => {
    if (options.failureStatus !== undefined) {
      return Response.json(
        { error: { message: "Configured deterministic speech failure" } },
        { status: options.failureStatus },
      );
    }

    const { pcm, words } =
      options.durationMilliseconds === undefined
        ? createWordBurstPcm(readRequestText(request))
        : { pcm: createTonePcm(options.durationMilliseconds), words: [] };
    synthesizedWordsByMetadata.set(toMetadataKey(runOptions?.gateway?.metadata), words);

    if (!Array.isArray(request) && request.provider === "elevenlabs") {
      return new Response(pcm, { headers: { "Content-Type": "audio/pcm" } });
    }

    return Response.json({
      steps: [{ content: [createAudioContent(pcm)] }],
    });
  };

  return {
    gateway: () => ({ run: gatewayRun }),
    run: async (_model, _inputs, runOptions) => {
      if (options.recognitionFailureStatus !== undefined) {
        return Response.json(
          { errors: [{ message: "Configured deterministic speech recognition failure" }] },
          { status: options.recognitionFailureStatus },
        );
      }

      const words = synthesizedWordsByMetadata.get(toMetadataKey(runOptions.gateway?.metadata));

      return Response.json({
        text: (words ?? []).map(({ word }) => word).join(" "),
        segments: words === undefined || words.length === 0 ? [] : [{ words }],
      });
    },
  };
}

function toMetadataKey(metadata: Record<string, unknown> | undefined): string {
  return JSON.stringify([
    metadata?.["conversionId"],
    metadata?.["narrationSegmentSequence"],
    metadata?.["synthesisAttempt"],
  ]);
}

function readRequestText(request: Parameters<AiGateway["run"]>[0]): string {
  if (Array.isArray(request)) {
    throw new Error("The fake speech AI expects one gateway request");
  }

  const query: unknown = request.query;
  if (typeof query !== "object" || query === null) {
    throw new Error("The fake speech AI expects a request query");
  }

  if ("text" in query && typeof query.text === "string") {
    return query.text;
  }

  if ("input" in query) {
    if (typeof query.input === "string") {
      return query.input.split("TRANSCRIPT:\n").at(-1) ?? query.input;
    }

    const message: unknown = Array.isArray(query.input) ? query.input[0] : undefined;
    const part: unknown =
      typeof message === "object" &&
      message !== null &&
      "content" in message &&
      Array.isArray(message.content)
        ? message.content[0]
        : undefined;
    if (typeof part === "object" && part !== null && "text" in part) {
      if (typeof part.text === "string") {
        return part.text;
      }
    }
  }

  throw new Error("The fake speech AI found no narration text in the request");
}

function createWordBurstPcm(text: string): { pcm: Uint8Array<ArrayBuffer>; words: FakeWord[] } {
  const tokens = [...text.trim().matchAll(/(\S+)(\s*)/gu)];
  const words: FakeWord[] = [];
  let milliseconds = 0;

  for (const [index, [, word = "", whitespace = ""]] of tokens.entries()) {
    words.push({
      word,
      start: milliseconds / 1_000,
      end: (milliseconds + WORD_DURATION_MILLISECONDS) / 1_000,
    });
    milliseconds += WORD_DURATION_MILLISECONDS;

    if (index < tokens.length - 1) {
      const isPause = whitespace.includes("\n") || /[.!?:;]$/u.test(word);
      milliseconds += isPause ? PAUSE_MILLISECONDS : WORD_GAP_MILLISECONDS;
    }
  }

  const pcm = new Uint8Array(millisecondsToSampleCount(Math.max(milliseconds, 1)) * 2);
  for (const { start } of words) {
    pcm.set(
      createTonePcm(WORD_DURATION_MILLISECONDS),
      millisecondsToSampleCount(start * 1_000) * 2,
    );
  }

  return { pcm, words };
}

function createTonePcm(durationMilliseconds: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(durationMilliseconds) || durationMilliseconds <= 0) {
    throw new Error("Fake speech duration must be a positive finite number");
  }

  const sampleCount = Math.max(1, millisecondsToSampleCount(durationMilliseconds));
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

function millisecondsToSampleCount(milliseconds: number): number {
  return Math.round((AUDIO_FORMAT.sampleRate * milliseconds) / 1_000);
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
