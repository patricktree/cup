import { z } from "zod";

import { AUDIO_FORMAT } from "#src/audio-format.ts";
import { PermanentNarrationSynthesisError, type SynthesisOptions } from "#src/speech-synthesis.ts";

const AUDIO_STREAM_CHUNK_SIZE = 64 * 1024;
const SPEECH_GATEWAY_ID = "default";
const SPEECH_ENDPOINT = "v1beta/interactions";
const GOOGLE_INTERACTIONS_API_REVISION = "2026-05-20";
const SYNTHESIS_REQUEST_TIMEOUT_MILLISECONDS = 90_000;
const RETRYABLE_INPUT_POLICY_BLOCK_PREFIX =
  "Input blocked: The prompt could not be submitted. The prompt contains sensitive words";

const AUDIO_MIME_TYPE_SCHEMA = z
  .string()
  .nonempty()
  .superRefine((contentType, context) => {
    const [mediaType, ...parameters] = contentType.toLowerCase().split(";");
    if (mediaType?.trim() !== "audio/l16") {
      context.addIssue({
        code: "custom",
        message: `Unexpected audio content type: ${contentType}`,
      });
    }
    const audioParameters = new Map(
      parameters.map((parameter) => {
        const [name, value = ""] = parameter.trim().split("=", 2);
        return [name, value] as const;
      }),
    );
    const rate = audioParameters.get("rate");
    if (rate !== undefined && rate !== AUDIO_FORMAT.sampleRate.toString()) {
      context.addIssue({ code: "custom", message: `Unexpected sample rate: ${rate}` });
    }
  });

const AUDIO_FORMAT_METADATA_SCHEMA = z.object({
  channels: z.literal(AUDIO_FORMAT.channelCount).optional(),
  sample_rate: z.literal(AUDIO_FORMAT.sampleRate).optional(),
  mime_type: AUDIO_MIME_TYPE_SCHEMA.optional(),
});

const AUDIO_RESPONSE_SCHEMA = z.object({
  errors: z
    .array(
      z.object({
        code: z.string().nonempty().optional(),
        message: z.string().nonempty().optional(),
      }),
    )
    .optional(),
  status: z.string().nonempty().optional(),
  steps: z.array(
    z.object({
      content: z.array(
        AUDIO_FORMAT_METADATA_SCHEMA.extend({
          data: z.string().nonempty(),
          mime_type: AUDIO_MIME_TYPE_SCHEMA,
          type: z.literal("audio"),
        }),
      ),
    }),
  ),
});

const AUDIO_STREAM_EVENT_SCHEMA = z.object({
  delta: z
    .looseObject({
      data: z.string().optional(),
      type: z.string(),
    })
    .optional(),
  event_type: z.string(),
});

const AUDIO_STREAM_ERROR_SCHEMA = z.object({
  error: z.object({
    code: z.union([z.string(), z.number()]).optional(),
    message: z.string().nonempty(),
  }),
});

const AUDIO_STREAM_DIAGNOSTIC_SCHEMA = z.object({
  errors: z
    .array(
      z.object({
        code: z.string().nonempty().optional(),
        message: z.string().nonempty().optional(),
      }),
    )
    .optional(),
  event_type: z.string().nonempty().optional(),
  interaction: z
    .object({
      errors: z
        .array(
          z.object({
            code: z.string().nonempty().optional(),
            message: z.string().nonempty().optional(),
          }),
        )
        .optional(),
      status: z.string().nonempty().optional(),
    })
    .optional(),
  status: z.string().nonempty().optional(),
});

export async function synthesizeGeminiAudio({
  ai,
  conversionId,
  narrationText,
  sequence,
  synthesisAttempt,
  synthesisResponseMode,
  speechConfig,
}: SynthesisOptions): Promise<Uint8Array> {
  const isStreaming = synthesisResponseMode === "streaming";
  const response = await ai.gateway(SPEECH_GATEWAY_ID).run(
    {
      provider: speechConfig.provider,
      endpoint: SPEECH_ENDPOINT,
      headers: {
        "Api-Revision": GOOGLE_INTERACTIONS_API_REVISION,
        "cf-aig-collect-log-payload": false,
        "Content-Type": "application/json",
      },
      query: {
        model: speechConfig.model,
        // Explicit speech instructions avoid Gemini's documented prompt-classifier false rejections.
        // https://ai.google.dev/gemini-api/docs/speech-generation#limitations
        input: `Synthesize speech by reading the following transcript verbatim.\nSpeak only the transcript, without adding commentary.\n\nTRANSCRIPT:\n${narrationText}`,
        response_format: {
          type: "audio",
          sample_rate: AUDIO_FORMAT.sampleRate,
        },
        generation_config: {
          speech_config: [{ voice: speechConfig.voice }],
        },
        stream: isStreaming,
      },
    },
    {
      gateway: {
        collectLog: true,
        id: SPEECH_GATEWAY_ID,
        metadata: {
          conversionId,
          narrationSegmentSequence: sequence,
          synthesisAttempt,
          synthesisResponseMode,
        },
        requestTimeoutMs: SYNTHESIS_REQUEST_TIMEOUT_MILLISECONDS,
      },
      signal: AbortSignal.timeout(SYNTHESIS_REQUEST_TIMEOUT_MILLISECONDS),
    },
  );

  if (!response.ok) {
    const responseBody = await readResponseBody(response);
    const providerMessage = getErrorMessage(responseBody);

    const message = `Google AI Studio narration synthesis failed with status ${response.status}: ${providerMessage}`;

    if (!isRetryableProviderError(response.status, providerMessage)) {
      throw new PermanentNarrationSynthesisError(message);
    }

    throw new Error(message);
  }

  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    if (!response.body) {
      throw new Error("Google AI Studio narration synthesis response did not contain a body");
    }

    return readAudioStream(createAudioStreamFromEvents(response.body));
  }

  return parseAudioResponse(await readResponseBody(response));
}

function parseAudioResponse(response: unknown): Uint8Array {
  const parsedResponse = AUDIO_RESPONSE_SCHEMA.safeParse(response);

  if (!parsedResponse.success) {
    throw new PermanentNarrationSynthesisError(
      `Google AI Studio narration synthesis returned an invalid response: ${z.prettifyError(parsedResponse.error)}`,
    );
  }

  const { errors, status, steps } = parsedResponse.data;
  const audio = steps.flatMap((step) => step.content)[0];

  if (!audio) {
    const diagnostic = formatProviderResultDiagnostic({ errors, status });
    const message = `Google AI Studio narration synthesis response did not contain audio data${diagnostic}`;

    if (errors?.some(({ code }) => isPermanentProviderErrorCode(code)) === true) {
      throw new PermanentNarrationSynthesisError(message);
    }

    throw new Error(message);
  }

  return decodeBase64(audio.data);
}

async function readAudioStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      chunks.push(result.value);
      totalLength += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const audio = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return audio;
}

/** Converts Google AI Studio server-sent events into decoded PCM audio chunks. */
function createAudioStreamFromEvents(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedAudio = false;
  const diagnostics = createAudioStreamDiagnostics();

  return new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          const nextEvent = takeServerSentEvent(buffer);

          if (nextEvent) {
            buffer = nextEvent.remainder;
            const audio = parseAudioStreamEvent(nextEvent.event, diagnostics);

            if (!audio) {
              continue;
            }

            receivedAudio = true;
            enqueueAudioChunks(controller, audio);
            return;
          }

          const result = await reader.read();

          if (result.done) {
            buffer += decoder.decode();

            const audio = parseAudioStreamEvent(buffer, diagnostics);

            if (audio) {
              receivedAudio = true;
              enqueueAudioChunks(controller, audio);
            }

            if (!receivedAudio) {
              const message = `Google AI Studio narration synthesis stream did not contain audio data${formatAudioStreamDiagnostics(diagnostics)}`;

              if (isPermanentProviderErrorCode(diagnostics.errorCode)) {
                throw new PermanentNarrationSynthesisError(message);
              }

              throw new Error(message);
            }

            controller.close();
            return;
          }

          buffer += decoder.decode(result.value, { stream: true });
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function takeServerSentEvent(buffer: string): { event: string; remainder: string } | undefined {
  const boundary = /\r?\n\r?\n/u.exec(buffer);

  if (!boundary || boundary.index === undefined) {
    return undefined;
  }

  return {
    event: buffer.slice(0, boundary.index),
    remainder: buffer.slice(boundary.index + boundary[0].length),
  };
}

function parseAudioStreamEvent(
  event: string,
  diagnostics: AudioStreamDiagnostics,
): Uint8Array | undefined {
  const data = event
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");

  if (data.length === 0 || data === "[DONE]") {
    if (data === "[DONE]") {
      diagnostics.lastEventType = "done";
      diagnostics.eventTypes.add("done");
    }

    return undefined;
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(data) as unknown;
  } catch {
    diagnostics.malformedEventCount += 1;
    return undefined;
  }

  recordAudioStreamDiagnostic(parsedJson, diagnostics);

  const parsedError = AUDIO_STREAM_ERROR_SCHEMA.safeParse(parsedJson);

  if (parsedError.success) {
    const { code, message } = parsedError.data.error;
    const error = `Google AI Studio narration synthesis failed${code === undefined ? "" : ` with code ${code}`}: ${message}`;

    if (isPermanentProviderErrorCode(code)) {
      throw new PermanentNarrationSynthesisError(error);
    }

    throw new Error(error);
  }

  const parsedEvent = AUDIO_STREAM_EVENT_SCHEMA.safeParse(parsedJson);

  if (
    !parsedEvent.success ||
    parsedEvent.data.event_type !== "step.delta" ||
    parsedEvent.data.delta?.type !== "audio" ||
    !parsedEvent.data.delta.data
  ) {
    return undefined;
  }

  const metadata = AUDIO_FORMAT_METADATA_SCHEMA.safeParse(parsedEvent.data.delta);
  if (!metadata.success) {
    throw new PermanentNarrationSynthesisError(
      `Google AI Studio narration synthesis returned invalid audio metadata: ${z.prettifyError(metadata.error)}`,
    );
  }

  return decodeBase64(parsedEvent.data.delta.data);
}

type AudioStreamDiagnostics = {
  errorCode?: string;
  errorMessage?: string;
  eventTypes: Set<string>;
  interactionStatus?: string;
  lastEventType?: string;
  malformedEventCount: number;
};

function createAudioStreamDiagnostics(): AudioStreamDiagnostics {
  return {
    eventTypes: new Set(),
    malformedEventCount: 0,
  };
}

function recordAudioStreamDiagnostic(event: unknown, diagnostics: AudioStreamDiagnostics): void {
  const parsedDiagnostic = AUDIO_STREAM_DIAGNOSTIC_SCHEMA.safeParse(event);

  if (!parsedDiagnostic.success) {
    return;
  }

  const { errors, event_type: eventType, interaction, status } = parsedDiagnostic.data;

  if (eventType !== undefined) {
    diagnostics.eventTypes.add(eventType);
    diagnostics.lastEventType = eventType;
  }

  const providerError = interaction?.errors?.[0] ?? errors?.[0];

  if (providerError?.code !== undefined) {
    diagnostics.errorCode = providerError.code;
  }

  if (providerError?.message !== undefined) {
    diagnostics.errorMessage = providerError.message;
  }

  const interactionStatus = interaction?.status ?? status;

  if (interactionStatus !== undefined) {
    diagnostics.interactionStatus = interactionStatus;
  }
}

function formatAudioStreamDiagnostics(diagnostics: AudioStreamDiagnostics): string {
  const details = [
    diagnostics.lastEventType === undefined
      ? undefined
      : `last event: ${diagnostics.lastEventType}`,
    diagnostics.interactionStatus === undefined
      ? undefined
      : `interaction status: ${diagnostics.interactionStatus}`,
    diagnostics.eventTypes.size === 0
      ? undefined
      : `event types: ${[...diagnostics.eventTypes].join(", ")}`,
    diagnostics.malformedEventCount === 0
      ? undefined
      : `malformed events: ${diagnostics.malformedEventCount}`,
    diagnostics.errorCode === undefined ? undefined : `error code: ${diagnostics.errorCode}`,
    diagnostics.errorMessage === undefined ? undefined : `error: ${diagnostics.errorMessage}`,
  ].filter((detail) => detail !== undefined);

  return details.length === 0 ? "" : ` (${details.join("; ")})`;
}

function decodeBase64(value: string): Uint8Array {
  let binaryValue: string;

  try {
    binaryValue = atob(value);
  } catch {
    throw new PermanentNarrationSynthesisError(
      "Google AI Studio narration synthesis returned invalid base64 audio data",
    );
  }

  const bytes = new Uint8Array(binaryValue.length);

  for (let index = 0; index < binaryValue.length; index += 1) {
    bytes[index] = binaryValue.charCodeAt(index);
  }

  return bytes;
}

function enqueueAudioChunks(
  controller: ReadableStreamDefaultController<Uint8Array>,
  audio: Uint8Array,
): void {
  for (let offset = 0; offset < audio.length; offset += AUDIO_STREAM_CHUNK_SIZE) {
    controller.enqueue(audio.subarray(offset, offset + AUDIO_STREAM_CHUNK_SIZE));
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const body = (await response.text()).trim();

  if (body.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function getErrorMessage(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }

  if (typeof response !== "object" || response === null || !("error" in response)) {
    return "The provider returned an error response";
  }

  const error = response.error;

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;

    if (typeof message === "string") {
      return message;
    }
  }

  return "The provider returned an error response";
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableProviderError(status: number, message: string): boolean {
  return (
    isRetryableProviderStatus(status) ||
    (status === 400 && message.startsWith(RETRYABLE_INPUT_POLICY_BLOCK_PREFIX))
  );
}

function isPermanentProviderErrorCode(code: string | number | undefined): boolean {
  if (code === undefined) {
    return false;
  }

  const normalizedCode = code.toString().toLowerCase();

  return [
    "blocked",
    "invalid_argument",
    "not_found",
    "permission_denied",
    "safety",
    "unauthenticated",
  ].some((permanentCode) => normalizedCode.includes(permanentCode));
}

function formatProviderResultDiagnostic({
  errors,
  status,
}: {
  errors?: readonly { code?: string | undefined; message?: string | undefined }[] | undefined;
  status?: string | undefined;
}): string {
  const providerError = errors?.[0];
  const details = [
    status === undefined ? undefined : `interaction status: ${status}`,
    providerError?.code === undefined ? undefined : `error code: ${providerError.code}`,
    providerError?.message === undefined ? undefined : `error: ${providerError.message}`,
  ].filter((detail) => detail !== undefined);

  return details.length === 0 ? "" : ` (${details.join("; ")})`;
}
