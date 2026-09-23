import { AUDIO_FORMAT } from "#src/audio-format.ts";
import { PermanentNarrationSynthesisError, type SynthesisOptions } from "#src/speech-synthesis.ts";

const REQUEST_TIMEOUT_MILLISECONDS = 90_000;

/** Requests raw signed 16-bit little-endian mono PCM for the shared MP3 encoder. */
export async function synthesizeElevenLabsAudio({
  ai,
  conversionId,
  narrationText,
  sequence,
  synthesisAttempt,
  synthesisResponseMode,
  speechConfig,
}: SynthesisOptions): Promise<Uint8Array> {
  const streamSuffix = synthesisResponseMode === "streaming" ? "/stream" : "";
  const response = await ai.gateway("default").run(
    {
      provider: "elevenlabs",
      endpoint: `v1/text-to-speech/${encodeURIComponent(speechConfig.voice)}${streamSuffix}?output_format=pcm_${AUDIO_FORMAT.sampleRate}`,
      headers: {
        "Content-Type": "application/json",
        "cf-aig-collect-log-payload": false,
      },
      query: {
        text: narrationText,
        model_id: speechConfig.model,
        voice_settings: { stability: 0.5 },
      },
    },
    {
      gateway: {
        id: "default",
        collectLog: true,
        metadata: {
          conversionId,
          narrationSegmentSequence: sequence,
          synthesisAttempt,
          synthesisResponseMode,
        },
        requestTimeoutMs: REQUEST_TIMEOUT_MILLISECONDS,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    },
  );

  if (!response.ok) {
    const message = `ElevenLabs narration synthesis failed with status ${response.status}: ${await response.text()}`;
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new Error(message);
    }
    throw new PermanentNarrationSynthesisError(message);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  // The PCM endpoint uses audio/pcm or application/octet-stream, not an MP3 container.
  if (contentType !== "audio/pcm" && contentType !== "application/octet-stream") {
    throw new PermanentNarrationSynthesisError(
      `ElevenLabs narration synthesis returned unexpected audio content type: ${contentType ?? "missing"}`,
    );
  }

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0 || audio.byteLength % 2 !== 0) {
    throw new Error("ElevenLabs narration synthesis returned empty or incomplete 16-bit PCM");
  }
  return audio;
}
