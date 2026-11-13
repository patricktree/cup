import path from "node:path";
import process from "node:process";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import { findCutPoint } from "#src/find-cut-point.ts";
import { recognizeSpeech } from "#src/recognize-speech.ts";
import type { SpeechSynthesisAi } from "#src/speech-synthesis.ts";
import { encodeMp3Frames } from "#src/synthesize-with-overlap-and-cut.ts";

import { decodeMp3ToPcm } from "#test/evals/decode-mp3.ts";
import { loadSpeechRecognitionCases } from "#test/evals/speech-recognition-cases.ts";

const CASES_DIRECTORY = path.join(import.meta.dirname, "cases");
const WRANGLER_CONFIG_PATH = path.join(import.meta.dirname, "wrangler.jsonc");
const NEAR_SILENT_TAKE_SECONDS = 1;

/**
 * The Whisper output the binding returns with `returnRawResponse`, checked more strictly than
 * production parses it: the REST API wraps the same output in `{ result }`, which production does
 * not expect.
 */
const RAW_WHISPER_OUTPUT_SCHEMA = z.looseObject({
  text: z.string(),
  segments: z
    .array(
      z.looseObject({
        words: z
          .array(z.looseObject({ word: z.string(), start: z.number(), end: z.number() }))
          .optional(),
      }),
    )
    .optional(),
});

const SPEECH_RECOGNITION_CASES = await loadSpeechRecognitionCases(CASES_DIRECTORY);

let platformProxy: Awaited<ReturnType<typeof getPlatformProxy<{ AI: SpeechSynthesisAi }>>>;

beforeAll(async () => {
  if (!process.env["CLOUDFLARE_ACCOUNT_ID"]) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID is missing: run the evals through `pnpm eval`, which reads .env.evals, or export it",
    );
  }

  // Workers AI bindings always run remotely: Wrangler opens a remote proxy session, authenticated
  // by its own login or an exported CLOUDFLARE_API_TOKEN.
  try {
    platformProxy = await getPlatformProxy<{ AI: SpeechSynthesisAi }>({
      configPath: WRANGLER_CONFIG_PATH,
      persist: false,
    });
  } catch (error) {
    throw new Error(
      "Cannot open the Workers AI binding: log in with `pnpm --filter @cup/audiobook-production exec wrangler login`, or export a CLOUDFLARE_API_TOKEN that may create Workers previews and run Workers AI",
      { cause: error },
    );
  }
});

afterAll(async () => {
  await platformProxy?.dispose();
});

test.each(SPEECH_RECOGNITION_CASES)(
  "speech recognition and the cut check decide the take as expected: $id",
  async ({
    id,
    recognitionLanguage,
    synthesizedText,
    chunkStartWordIndex,
    expectedPause,
    expectedRejection,
    providerMp3,
  }) => {
    const providerPcm = await decodeMp3ToPcm(providerMp3);
    const { ai, readRawOutputs } = recordRawOutputs(platformProxy.env.AI);

    const recognizedWords = await recognizeSpeech({
      ai,
      mp3: await encodeMp3Frames(providerPcm),
      recognitionLanguage,
      conversionId: `speech-recognition-eval-${id}`,
      sequence: 0,
      synthesisAttempt: 0,
    });

    const [rawOutput] = await readRawOutputs();
    expect(rawOutput).not.toHaveProperty("result");
    // every word comes with its text and timing, which production would otherwise drop
    const { segments = [] } = RAW_WHISPER_OUTPUT_SCHEMA.parse(rawOutput);
    expect(segments.flatMap(({ words = [] }) => words)).not.toHaveLength(0);

    const cutPoint = findCutPoint({
      synthesizedText,
      chunkStartWordIndex,
      recognizedWords,
      providerPcm,
    });

    const decision = cutPoint.isAccepted
      ? {
          isAccepted: true,
          isInExpectedPause:
            expectedPause.startSeconds <= cutPoint.cutPointSeconds &&
            cutPoint.cutPointSeconds <= expectedPause.endSeconds,
        }
      : { isAccepted: false, reason: cutPoint.reason };
    const expectedDecision =
      expectedRejection === undefined
        ? { isAccepted: true, isInExpectedPause: true }
        : { isAccepted: false, reason: expectedRejection };

    // the words and the cut check's evidence explain a failure in the diff
    expect({ ...decision, recognizedWords, cutPoint }).toMatchObject(expectedDecision);
  },
);

test("speech recognition of a near-silent take parses and places no accepted cut", async () => {
  const providerPcm = createNearSilentPcm(NEAR_SILENT_TAKE_SECONDS);
  const { ai, readRawOutputs } = recordRawOutputs(platformProxy.env.AI);

  const recognizedWords = await recognizeSpeech({
    ai,
    mp3: await encodeMp3Frames(providerPcm),
    recognitionLanguage: "en",
    conversionId: "speech-recognition-eval-near-silent-take",
    sequence: 0,
    synthesisAttempt: 0,
  });

  const [rawOutput] = await readRawOutputs();
  expect(rawOutput).not.toHaveProperty("result");
  RAW_WHISPER_OUTPUT_SCHEMA.parse(rawOutput);

  const cutPoint = findCutPoint({
    synthesizedText: "The overlap sentence ends here.\n\nThe narration chunk begins.",
    chunkStartWordIndex: 5,
    recognizedWords,
    providerPcm,
  });

  expect(cutPoint.isAccepted).toBe(false);
});

/**
 * Wraps the binding so that each run's raw response body can be read after production read it. The
 * wrapper leaves out the abort signal, which the platform proxy cannot pass from Node.js into
 * workerd; the gateway's request timeout still bounds the request.
 */
function recordRawOutputs(binding: SpeechSynthesisAi): {
  ai: SpeechSynthesisAi;
  readRawOutputs: () => Promise<unknown[]>;
} {
  const responses: Response[] = [];

  return {
    ai: {
      gateway: (gatewayId) => binding.gateway(gatewayId),
      run: async (model, inputs, { signal: _signal, ...options }) => {
        const response = await binding.run(model, inputs, options);
        responses.push(response.clone());
        return response;
      },
    },
    readRawOutputs: () =>
      Promise.all(responses.map(async (response): Promise<unknown> => response.json())),
  };
}

/** Low noise well below the cut check's silence threshold, as a take of a silent room would be. */
function createNearSilentPcm(seconds: number): Uint8Array {
  const sampleCount = seconds * 24_000;
  const pcm = new DataView(new ArrayBuffer(sampleCount * 2));

  for (let sample = 0; sample < sampleCount; sample++) {
    pcm.setInt16(sample * 2, Math.round(Math.sin(sample * 1.7) * 20), true);
  }

  return new Uint8Array(pcm.buffer);
}
