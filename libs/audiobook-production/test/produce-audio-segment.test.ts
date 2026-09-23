import { expect, test } from "vitest";

import {
  PermanentNarrationSynthesisError,
  produceAudioSegment,
  type ProduceOptions,
  type SpeechSynthesisAi,
} from "#src/produce-audio-segment.ts";
import { GEMINI_SPEECH_CONFIG } from "#src/speech-synthesis-config.ts";

const CONVERSION_ID = "018f4d80-5b9e-7a43-9cf4-8e192b37cbd8";
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
    speechConfig: GEMINI_SPEECH_CONFIG,
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
      input:
        "Synthesize speech by reading the following transcript verbatim.\nSpeak only the transcript, without adding commentary.\n\nTRANSCRIPT:\nA bounded narration request.",
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
        input:
          "Synthesize speech by reading the following transcript verbatim.\nSpeak only the transcript, without adding commentary.\n\nTRANSCRIPT:\nNews Writer",
        stream: synthesisResponseMode === "streaming",
      },
    });
  },
);

test("reports sanitized interaction diagnostics when a stream contains no audio", async () => {
  const run: SpeechSynthesisRun = async () =>
    createEventStreamResponse([
      {
        event_type: "interaction.created",
        interaction: { status: "in_progress" },
      },
      {
        event_type: "interaction.completed",
        interaction: { status: "completed" },
      },
      "[DONE]",
    ]);

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
  const run: SpeechSynthesisRun = async () =>
    createEventStreamResponse([
      {
        event_type: "interaction.completed",
        interaction: {
          status: "failed",
          errors: [{ code: "SAFETY_BLOCKED", message: "The narration was blocked." }],
        },
      },
      "[DONE]",
    ]);

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
