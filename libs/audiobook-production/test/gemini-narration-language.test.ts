import { expect, test } from "vitest";
import { z } from "zod";

import {
  GEMINI_SPEECH_CONFIG,
  LEGACY_GEMINI_V3_SPEECH_CONFIG,
  LEGACY_GEMINI_V4_SPEECH_CONFIG,
  LEGACY_GEMINI_V5_SPEECH_CONFIG,
  type SpeechConfig,
} from "#src/speech-synthesis-config.ts";
import type { SynthesisOptions } from "#src/speech-synthesis.ts";
import { synthesizeGeminiAudio } from "#src/synthesize-gemini-audio.ts";

type GatewayRun = ReturnType<SynthesisOptions["ai"]["gateway"]>["run"];
const CAPTURED_REQUEST_SCHEMA = z.object({
  query: z.object({ model: z.unknown(), input: z.unknown(), generation_config: z.unknown() }),
});

const NARRATION_TEXT = "Gerald John, Alicia Prager, Sandra Schieder";
const TODAYS_INPUT = [
  { type: "user_input", content: [{ type: "text", text: NARRATION_TEXT }] },
] as const;
const TODAYS_GENERATION_CONFIG = { speech_config: [{ voice: "Charon" }] } as const;
// Policy 6 sends exactly the request policy 5 sends; only the stored audio's pace differs.
const POLICIES_WITH_LANGUAGE = [
  ["v5", LEGACY_GEMINI_V5_SPEECH_CONFIG],
  ["v6", GEMINI_SPEECH_CONFIG],
] as const;

test.each(
  POLICIES_WITH_LANGUAGE.flatMap(([policy, speechConfig]) =>
    (
      [
        ["de-AT", "German"],
        ["de", "German"],
        ["fr", "French"],
        ["en-GB", "English"],
      ] as const
    ).map(
      ([narrationLanguage, englishName]) =>
        [policy, narrationLanguage, englishName, speechConfig] as const,
    ),
  ),
)(
  "a policy %s request in the speakable narration language %s carries the language and a %s style",
  async (_, narrationLanguage, englishName, speechConfig) => {
    const request = await captureRequest(speechConfig, narrationLanguage);

    expect(request.query).toMatchObject({
      input: [
        {
          type: "user_input",
          content: [
            {
              type: "text",
              text: NARRATION_TEXT,
              annotations: [
                {
                  type: "speech_metadata",
                  style: `Read in ${englishName} with standard ${englishName} pronunciation.`,
                },
              ],
            },
          ],
        },
      ],
      generation_config: { speech_config: [{ voice: "Charon", language: narrationLanguage }] },
    });
  },
);

test.each(
  POLICIES_WITH_LANGUAGE.flatMap(([policy, speechConfig]) =>
    ["sv", "fi-FI", "th"].map(
      (narrationLanguage) => [policy, narrationLanguage, speechConfig] as const,
    ),
  ),
)(
  "a policy %s request in the unspeakable narration language %s carries neither language nor style",
  async (_, narrationLanguage, speechConfig) => {
    const request = await captureRequest(speechConfig, narrationLanguage);

    // toEqual, not toMatchObject, so a stray language or style fails the test.
    expect(request.query.input).toEqual(TODAYS_INPUT);
    expect(request.query.generation_config).toEqual(TODAYS_GENERATION_CONFIG);
  },
);

test.each(POLICIES_WITH_LANGUAGE)(
  "a policy %s request without a narration language is today's request",
  async (_, speechConfig) => {
    const request = await captureRequest(speechConfig, undefined);

    // toEqual, not toMatchObject, so a stray language or style fails the test.
    expect(request.query.input).toEqual(TODAYS_INPUT);
    expect(request.query.generation_config).toEqual(TODAYS_GENERATION_CONFIG);
  },
);

test("a policy v6 request is exactly the policy v5 request", async () => {
  const policy5Request = await captureWholeRequest(LEGACY_GEMINI_V5_SPEECH_CONFIG, "de-AT");
  const policy6Request = await captureWholeRequest(GEMINI_SPEECH_CONFIG, "de-AT");

  expect(policy6Request).toEqual(policy5Request);
});

test("a policy v4 request ignores the narration language", async () => {
  const request = await captureRequest(LEGACY_GEMINI_V4_SPEECH_CONFIG, "de-AT");

  expect(request.query).toMatchObject({ model: "gemini-3.8-flash-lite-tts" });
  // toEqual, not toMatchObject, so a stray language or style fails the test.
  expect(request.query.input).toEqual(TODAYS_INPUT);
  expect(request.query.generation_config).toEqual(TODAYS_GENERATION_CONFIG);
});

test("a policy v3 request ignores the narration language", async () => {
  const request = await captureRequest(LEGACY_GEMINI_V3_SPEECH_CONFIG, "de-AT");

  expect(request.query).toMatchObject({
    model: "gemini-3.1-flash-tts-preview",
    input: `Synthesize speech by reading the following transcript verbatim.\nSpeak only the transcript, without adding commentary.\n\nTRANSCRIPT:\n${NARRATION_TEXT}`,
  });
  expect(request.query.generation_config).toEqual(TODAYS_GENERATION_CONFIG);
});

async function captureRequest(
  speechConfig: SpeechConfig,
  narrationLanguage: string | undefined,
): Promise<z.infer<typeof CAPTURED_REQUEST_SCHEMA>> {
  return CAPTURED_REQUEST_SCHEMA.parse(await captureWholeRequest(speechConfig, narrationLanguage));
}

async function captureWholeRequest(
  speechConfig: SpeechConfig,
  narrationLanguage: string | undefined,
): Promise<unknown> {
  let captured: unknown;
  const run: GatewayRun = async (request: unknown) => {
    captured = request;
    return Response.json({
      steps: [{ content: [{ type: "audio", data: "AQI=", mime_type: "audio/l16;rate=24000" }] }],
    });
  };

  await synthesizeGeminiAudio({
    ai: { gateway: () => ({ run }) },
    conversionId: "narration-language-test",
    narrationText: NARRATION_TEXT,
    sequence: 0,
    synthesisAttempt: 1,
    synthesisResponseMode: "non-streaming",
    speechConfig,
    narrationLanguage,
  });

  return captured;
}
