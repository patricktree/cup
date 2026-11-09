import type { Completion } from "#src/completion.ts";
import { createNarrationLanguageDetector } from "#src/narration-language-detection.ts";
import { PRODUCTION_DETECTION_CONFIG } from "#src/production-narration-language-detection.ts";

/** Answers a given language subtag, answers nothing (`null`), or fails on every call. */
export type FakeNarrationLanguageDetectorOptions = { answer: string | null } | { failure: Error };

/**
 * Creates a detector whose model call is deterministic, so the production rules for regions and
 * fallbacks still apply to its answer.
 */
export function createFakeNarrationLanguageDetector(options: FakeNarrationLanguageDetectorOptions) {
  const completion: Completion = async (request) => {
    if ("failure" in options) {
      throw options.failure;
    }

    return {
      provider: "fake",
      model: "deterministic-language-detection",
      toolCalls:
        options.answer === null
          ? []
          : [
              {
                id: "fake-detection-call",
                name: request.tool.name,
                arguments: { language: options.answer },
              },
            ],
      stopReason: options.answer === null ? "stop" : "toolUse",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    };
  };

  return createNarrationLanguageDetector({ ...PRODUCTION_DETECTION_CONFIG, completion });
}
