import type { SpeechSynthesisAi } from "@cup/audiobook-production";
import { createFakeSpeechSynthesisAi } from "@cup/audiobook-production/fake";

const SPEECH_CALLS_PREFIX = "qa/speech-calls/";
const SPEECH_RELEASE_KEY = "qa/speech-released";

/**
 * Records local provider requests and optionally holds responses to exercise concurrent
 * reservations.
 */
export function createTrackedSpeechProvider(bucket: R2Bucket, scenario: string): SpeechSynthesisAi {
  const provider = createFakeSpeechSynthesisAi(
    scenario === "tts-failure"
      ? { failureStatus: 503 }
      : scenario === "speech-gated"
        ? { durationMilliseconds: 8_000 }
        : {},
  );
  return {
    gateway: (gatewayId) => ({
      run: async (request, options) => {
        const conversionId = options?.gateway?.metadata?.["conversionId"];
        const query: unknown = Array.isArray(request) ? undefined : request.query;
        if (typeof conversionId !== "string") throw new Error("Narration request identity missing");
        const characters = narrationTextFromRequest(query).length;
        await bucket.put(`${SPEECH_CALLS_PREFIX}${crypto.randomUUID()}`, "", {
          customMetadata: { conversionId, characters: String(characters) },
        });
        if (scenario === "speech-gated") {
          const deadline = performance.now() + 30_000;
          while ((await bucket.head(SPEECH_RELEASE_KEY)) === null) {
            if (performance.now() >= deadline)
              throw new Error("The E2E speech gate was not released");
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        return provider.gateway(gatewayId).run(request, options);
      },
    }),
  };
}

function narrationTextFromRequest(query: unknown): string {
  if (typeof query === "object" && query !== null) {
    if ("text" in query && typeof query.text === "string") return query.text;
    if ("input" in query) {
      if (typeof query.input === "string") {
        const transcript = query.input.split("TRANSCRIPT:\n")[1];
        if (transcript !== undefined) return transcript;
      }
      if (Array.isArray(query.input)) {
        const message: unknown = query.input[0];
        if (
          typeof message === "object" &&
          message !== null &&
          "content" in message &&
          Array.isArray(message.content)
        ) {
          const part: unknown = message.content[0];
          if (
            typeof part === "object" &&
            part !== null &&
            "text" in part &&
            typeof part.text === "string"
          )
            return part.text;
        }
      }
    }
  }
  throw new Error("Narration request text missing");
}

/** These controls are served only by the isolated QA Worker. */
export async function handleSpeechControl(
  request: Request,
  bucket: R2Bucket,
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/__qa/speech-calls" && request.method === "GET") {
    const calls = await bucket.list({ prefix: SPEECH_CALLS_PREFIX, include: ["customMetadata"] });
    return Response.json(
      calls.objects.map((object) => ({
        conversionId: object.customMetadata?.["conversionId"],
        characters: Number(object.customMetadata?.["characters"]),
      })),
    );
  }
  if (pathname === "/__qa/release-speech" && request.method === "POST") {
    await bucket.put(SPEECH_RELEASE_KEY, "released");
    return new Response(null, { status: 204 });
  }
  return undefined;
}
