import { expect, test, vi } from "vitest";

import {
  PermanentNarrationSynthesisError,
  produceAudioSegment,
  type ProduceOptions,
  type SpeechSynthesisAi,
} from "#src/produce-audio-segment.ts";
import { createFakeSpeechSynthesisAi } from "#src/speech-synthesis-ai.fake.ts";
import {
  GEMINI_SPEECH_CONFIG,
  LEGACY_GEMINI_V3_SPEECH_CONFIG,
  LEGACY_GEMINI_V5_SPEECH_CONFIG,
} from "#src/speech-synthesis-config.ts";

const CONVERSION_ID = "018f4d80-5b9e-7a43-9cf4-8e192b37cbd8";
// 100 MP3 frames of 24 ms, so the provider PCM fills whole frames.
const PROVIDER_PCM_DURATION_MILLISECONDS = 2_400;
const MP3_FRAME_DURATION_MILLISECONDS = 24;
// LAME's encoder delay and its flush add two frames to every encoded segment, stretched or not.
const ENCODER_OVERHEAD_MILLISECONDS = 2 * MP3_FRAME_DURATION_MILLISECONDS;
type SpeechSynthesisRun = ReturnType<SpeechSynthesisAi["gateway"]>["run"];
type SpeechSynthesisRequest = Parameters<SpeechSynthesisRun>[0];
type SpeechSynthesisOptions = Parameters<SpeechSynthesisRun>[1];

test("configures a bounded observable non-streaming synthesis attempt", async () => {
  let gatewayRequest: unknown;
  let gatewayOptions: unknown;
  const run: SpeechSynthesisRun = async (
    request: SpeechSynthesisRequest,
    options: SpeechSynthesisOptions,
  ) => {
    gatewayRequest = request;
    gatewayOptions = options;
    return createAudioResponse();
  };

  await produceAudioSegment({
    ai: createSpeechSynthesisAi(run),
    bucket: createAudioSegmentBucket(),
    conversionId: CONVERSION_ID,
    sequence: 7,
    narrationChunk: { text: "A bounded narration request." },
    synthesisAttempt: 2,
    synthesisResponseMode: "non-streaming",
  });

  expect(gatewayRequest).toMatchObject({
    provider: "google-ai-studio",
    endpoint: "v1beta/interactions",
    headers: {
      "Api-Revision": "2026-05-20",
      "cf-aig-collect-log-payload": false,
      "Content-Type": "application/json",
    },
    query: {
      model: "gemini-3.8-flash-lite-tts",
      input: [
        { type: "user_input", content: [{ type: "text", text: "A bounded narration request." }] },
      ],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24_000 },
      generation_config: { speech_config: [{ voice: "Charon" }] },
      stream: false,
    },
  });
  expect(gatewayOptions).toMatchObject({
    gateway: {
      collectLog: true,
      id: "default",
      metadata: {
        conversionId: CONVERSION_ID,
        narrationSegmentSequence: 7,
        synthesisAttempt: 2,
        synthesisResponseMode: "non-streaming",
      },
      requestTimeoutMs: 90_000,
    },
    signal: expect.any(AbortSignal),
  });
});

test.each(["streaming", "non-streaming"] as const)(
  "identifies short text as a verbatim transcript in %s requests",
  async (synthesisResponseMode) => {
    let gatewayRequest: unknown;
    const run: SpeechSynthesisRun = async (request: SpeechSynthesisRequest) => {
      gatewayRequest = request;
      return createAudioResponse();
    };

    await produceAudioSegment({
      speechConfig: GEMINI_SPEECH_CONFIG,
      ai: createSpeechSynthesisAi(run),
      bucket: createAudioSegmentBucket(),
      conversionId: CONVERSION_ID,
      sequence: 4,
      narrationChunk: { text: "News Writer" },
      synthesisResponseMode,
    });

    expect(gatewayRequest).toMatchObject({
      query: {
        model: "gemini-3.8-flash-lite-tts",
        input: [{ type: "user_input", content: [{ type: "text", text: "News Writer" }] }],
        response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24_000 },
        stream: synthesisResponseMode === "streaming",
      },
    });
  },
);

test.each(["streaming", "non-streaming"] as const)(
  "retains the legacy Gemini request policy for resumed conversions in %s mode",
  async (synthesisResponseMode) => {
    let gatewayRequest: unknown;
    const run: SpeechSynthesisRun = async (request: SpeechSynthesisRequest) => {
      gatewayRequest = request;
      return createAudioResponse();
    };

    const segment = await produceAudioSegment({
      speechConfig: LEGACY_GEMINI_V3_SPEECH_CONFIG,
      ai: createSpeechSynthesisAi(run),
      bucket: createAudioSegmentBucket(),
      conversionId: CONVERSION_ID,
      sequence: 0,
      narrationChunk: { text: "News Writer" },
      synthesisResponseMode,
    });

    expect(segment.speechConfig).toEqual(LEGACY_GEMINI_V3_SPEECH_CONFIG);
    expect(gatewayRequest).toMatchObject({
      query: {
        model: "gemini-3.1-flash-tts-preview",
        input:
          "Synthesize speech by reading the following transcript verbatim.\nSpeak only the transcript, without adding commentary.\n\nTRANSCRIPT:\nNews Writer",
        stream: synthesisResponseMode === "streaming",
      },
    });
  },
);

test("reports sanitized interaction diagnostics when a stream contains no audio", async () => {
  const events: Parameters<typeof createEventStreamResponse>[0] = [
    {
      event_type: "interaction.created",
      interaction: { status: "in_progress" },
    },
    {
      event_type: "interaction.completed",
      interaction: { status: "completed" },
    },
    "[DONE]",
  ];
  const run: SpeechSynthesisRun = async () => createEventStreamResponse(events);

  await expect(
    produceAudioSegment({
      speechConfig: GEMINI_SPEECH_CONFIG,
      ai: createSpeechSynthesisAi(run),
      bucket: createAudioSegmentBucket(),
      conversionId: CONVERSION_ID,
      sequence: 0,
      narrationChunk: { text: "An empty provider stream." },
    }),
  ).rejects.toThrow(
    "Google AI Studio narration synthesis stream did not contain audio data (last event: done; interaction status: completed; event types: interaction.created, interaction.completed, done)",
  );
});

test("marks a confirmed provider safety refusal as permanent", async () => {
  const events: Parameters<typeof createEventStreamResponse>[0] = [
    {
      event_type: "interaction.completed",
      interaction: {
        status: "failed",
        errors: [{ code: "SAFETY_BLOCKED", message: "The narration was blocked." }],
      },
    },
    "[DONE]",
  ];
  const run: SpeechSynthesisRun = async () => createEventStreamResponse(events);

  const error = await produceAudioSegment({
    speechConfig: GEMINI_SPEECH_CONFIG,
    ai: createSpeechSynthesisAi(run),
    bucket: createAudioSegmentBucket(),
    conversionId: CONVERSION_ID,
    sequence: 0,
    narrationChunk: { text: "A blocked narration request." },
  }).catch((caughtError: unknown) => caughtError);

  expect(error).toBeInstanceOf(PermanentNarrationSynthesisError);
  expect(error).toMatchObject({
    message:
      "Google AI Studio narration synthesis stream did not contain audio data (last event: done; interaction status: failed; event types: interaction.completed, done; error code: SAFETY_BLOCKED; error: The narration was blocked.)",
  });
});

test("keeps timeouts, rate limits, and server failures retryable", async () => {
  for (const status of [408, 429, 503]) {
    const run: SpeechSynthesisRun = async () =>
      Response.json({ error: { message: "Try again later." } }, { status });
    const error = await produceAudioSegment({
      speechConfig: GEMINI_SPEECH_CONFIG,
      ai: createSpeechSynthesisAi(run),
      bucket: createAudioSegmentBucket(),
      conversionId: CONVERSION_ID,
      sequence: 0,
      narrationChunk: { text: "A retryable narration request." },
    }).catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentNarrationSynthesisError);
    expect(error).toMatchObject({
      message: `Google AI Studio narration synthesis failed with status ${status}: Try again later.`,
    });
  }
});

test("keeps transient input policy blocks retryable", async () => {
  const error = await produceAudioSegment({
    speechConfig: GEMINI_SPEECH_CONFIG,
    ai: createSpeechSynthesisAi(createTransientInputPolicyBlockResponse),
    bucket: createAudioSegmentBucket(),
    conversionId: CONVERSION_ID,
    sequence: 34,
    narrationChunk: { text: "A transiently blocked narration request." },
  }).catch((caughtError: unknown) => caughtError);

  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(PermanentNarrationSynthesisError);
  expect(error).toMatchObject({
    message: expect.stringContaining("Input blocked: The prompt could not be submitted."),
  });
});

test("marks invalid requests and unsupported audio formats as permanent", async () => {
  const invalidRequestError = await produceAudioSegment({
    speechConfig: GEMINI_SPEECH_CONFIG,
    ai: createSpeechSynthesisAi(createInvalidRequestResponse),
    bucket: createAudioSegmentBucket(),
    conversionId: CONVERSION_ID,
    sequence: 0,
    narrationChunk: { text: "An invalid narration request." },
  }).catch((caughtError: unknown) => caughtError);

  expect(invalidRequestError).toBeInstanceOf(PermanentNarrationSynthesisError);

  const unsupportedFormatError = await produceAudioSegment({
    speechConfig: GEMINI_SPEECH_CONFIG,
    ai: createSpeechSynthesisAi(createUnsupportedFormatResponse),
    bucket: createAudioSegmentBucket(),
    conversionId: CONVERSION_ID,
    sequence: 0,
    narrationChunk: { text: "An unsupported narration response." },
    synthesisResponseMode: "non-streaming",
  }).catch((caughtError: unknown) => caughtError);

  expect(unsupportedFormatError).toBeInstanceOf(PermanentNarrationSynthesisError);
});

test.each([
  ["de-AT", "de-AT"],
  // An unspeakable language is left out of the request but is still the narration language.
  ["sv", "sv"],
  [undefined, undefined],
] as const)(
  "records the narration language %s as the segment's synthesis language",
  async (narrationLanguage, synthesisLanguage) => {
    const bucket = createAudioSegmentBucket();
    const put = vi.spyOn(bucket, "put");

    await produceAudioSegment({
      speechConfig: GEMINI_SPEECH_CONFIG,
      ai: createSpeechSynthesisAi(async () => createAudioResponse()),
      bucket,
      conversionId: CONVERSION_ID,
      sequence: 0,
      narrationChunk: { text: "Gerald John, Alicia Prager, Sandra Schieder" },
      ...(narrationLanguage === undefined ? {} : { narrationLanguage }),
    });

    expect(put.mock.calls[0]?.[2].customMetadata["synthesis-language"]).toBe(synthesisLanguage);
  },
);

test.each([
  ["de-AT", "de"],
  ["de-AT", undefined],
  [undefined, "de-AT"],
] as const)(
  "does not reuse a stored segment synthesized in %s for the narration language %s",
  async (storedLanguage, narrationLanguage) => {
    const options = {
      speechConfig: GEMINI_SPEECH_CONFIG,
      ai: createSpeechSynthesisAi(async () => createAudioResponse()),
      bucket: createAudioSegmentBucket(),
      conversionId: CONVERSION_ID,
      sequence: 0,
      narrationChunk: { text: "Gerald John, Alicia Prager, Sandra Schieder" },
    };
    await produceAudioSegment({
      ...options,
      ...(storedLanguage === undefined ? {} : { narrationLanguage: storedLanguage }),
    });

    await expect(
      produceAudioSegment({
        ...options,
        ...(narrationLanguage === undefined ? {} : { narrationLanguage }),
      }),
    ).rejects.toThrow("identity conflicts");
  },
);

test("reuses a stored segment synthesized in the same narration language", async () => {
  const run = vi.fn<SpeechSynthesisRun>(async () => createAudioResponse());
  const options = {
    speechConfig: GEMINI_SPEECH_CONFIG,
    ai: createSpeechSynthesisAi(run),
    bucket: createAudioSegmentBucket(),
    conversionId: CONVERSION_ID,
    sequence: 0,
    narrationChunk: { text: "Gerald John, Alicia Prager, Sandra Schieder" },
    narrationLanguage: "de-AT",
  };
  const segment = await produceAudioSegment(options);

  await expect(produceAudioSegment(options)).resolves.toEqual(segment);
  expect(run).toHaveBeenCalledTimes(1);
});

test("a policy 6 segment stores the provider PCM stretched by 1.05 and records policy 6", async () => {
  const bucket = createAudioSegmentBucket();
  const put = vi.spyOn(bucket, "put");

  const segment = await produceAudioSegment({
    speechConfig: GEMINI_SPEECH_CONFIG,
    ai: createFakeSpeechSynthesisAi({ durationMilliseconds: PROVIDER_PCM_DURATION_MILLISECONDS }),
    bucket,
    conversionId: CONVERSION_ID,
    sequence: 0,
    narrationChunk: { text: "A briskly narrated paragraph." },
  });

  // 2,400 ms / 1.05 is about 2,286 ms.
  expect(
    Math.abs(segment.durationMilliseconds - (2_286 + ENCODER_OVERHEAD_MILLISECONDS)),
  ).toBeLessThanOrEqual(MP3_FRAME_DURATION_MILLISECONDS);
  expect(put.mock.calls[0]?.[2].customMetadata["synthesis-policy-version"]).toBe("6");
});

test("a segment of a manifest prepared under policy 5 keeps the provider PCM's duration", async () => {
  const bucket = createAudioSegmentBucket();
  const put = vi.spyOn(bucket, "put");

  const segment = await produceAudioSegment({
    speechConfig: LEGACY_GEMINI_V5_SPEECH_CONFIG,
    ai: createFakeSpeechSynthesisAi({ durationMilliseconds: PROVIDER_PCM_DURATION_MILLISECONDS }),
    bucket,
    conversionId: CONVERSION_ID,
    sequence: 0,
    narrationChunk: { text: "A paragraph narrated at the earlier pace." },
  });

  expect(segment.durationMilliseconds).toBe(
    PROVIDER_PCM_DURATION_MILLISECONDS + ENCODER_OVERHEAD_MILLISECONDS,
  );
  expect(put.mock.calls[0]?.[2].customMetadata["synthesis-policy-version"]).toBe("5");
});

test.each([
  ["policy 5", "policy 6", LEGACY_GEMINI_V5_SPEECH_CONFIG, GEMINI_SPEECH_CONFIG],
  ["policy 6", "policy 5", GEMINI_SPEECH_CONFIG, LEGACY_GEMINI_V5_SPEECH_CONFIG],
] as const)(
  "does not reuse a stored %s segment for a %s conversion",
  async (_storedPolicy, _conversionPolicy, storedSpeechConfig, speechConfig) => {
    const options = {
      ai: createFakeSpeechSynthesisAi(),
      bucket: createAudioSegmentBucket(),
      conversionId: CONVERSION_ID,
      sequence: 0,
      narrationChunk: { text: "A paragraph narrated at one pace." },
      narrationLanguage: "en-US",
    };
    await produceAudioSegment({ ...options, speechConfig: storedSpeechConfig });

    await expect(produceAudioSegment({ ...options, speechConfig })).rejects.toThrow(
      "identity conflicts",
    );
  },
);

test.each([
  ["policy 5", LEGACY_GEMINI_V5_SPEECH_CONFIG],
  ["policy 6", GEMINI_SPEECH_CONFIG],
] as const)(
  "reuses a stored %s segment for a conversion of the same policy",
  async (_, speechConfig) => {
    const run = vi.fn<SpeechSynthesisRun>(createFakeSpeechSynthesisAi().gateway("default").run);
    const options = {
      speechConfig,
      ai: createSpeechSynthesisAi(run),
      bucket: createAudioSegmentBucket(),
      conversionId: CONVERSION_ID,
      sequence: 0,
      narrationChunk: { text: "A paragraph narrated at one pace." },
      narrationLanguage: "en-US",
    };
    const segment = await produceAudioSegment(options);

    await expect(produceAudioSegment(options)).resolves.toEqual(segment);
    expect(run).toHaveBeenCalledTimes(1);
  },
);

function createSpeechSynthesisAi(run: SpeechSynthesisRun): SpeechSynthesisAi {
  return {
    gateway: () => ({ run }),
  };
}

async function createInvalidRequestResponse(): Promise<Response> {
  return Response.json({ error: { message: "Invalid speech configuration." } }, { status: 400 });
}

async function createTransientInputPolicyBlockResponse(): Promise<Response> {
  return Response.json(
    {
      error: {
        message:
          "Input blocked: The prompt could not be submitted. The prompt contains sensitive words that violate Google's Generative AI Prohibited Use policy. Try rephrasing the prompt.",
      },
    },
    { status: 400 },
  );
}

async function createUnsupportedFormatResponse(): Promise<Response> {
  return createAudioResponse({ mimeType: "audio/wav" });
}

function createAudioSegmentBucket(): ProduceOptions["bucket"] {
  const objects = new Map<
    string,
    {
      key: string;
      size: number;
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  >();

  return {
    head: (key) => Promise.resolve(objects.get(key) ?? null),
    put: (key, value, options) => {
      const object = {
        key,
        size: value.byteLength,
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      };
      objects.set(key, object);
      return Promise.resolve(object);
    },
  };
}

function createAudioResponse({ mimeType = "audio/l16;rate=24000" } = {}): Response {
  const pcm = new Uint8Array(4_800);

  return Response.json({
    status: "completed",
    steps: [
      {
        content: [
          {
            type: "audio",
            data: encodeBase64(pcm),
            mime_type: mimeType,
            sample_rate: 24_000,
            channels: 1,
          },
        ],
      },
    ],
  });
}

function createEventStreamResponse(events: readonly (object | "[DONE]")[]): Response {
  const body = events
    .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
    .join("");

  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function encodeBase64(value: Uint8Array): string {
  return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));
}
