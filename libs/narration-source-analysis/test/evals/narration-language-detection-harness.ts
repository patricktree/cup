import { createHarness } from "vitest-evals";
import type { TranscriptEvent } from "vitest-evals";

import type { SelectionCompletionResponse } from "#src/narration-content-selection.ts";
import { createNarrationLanguageDetector } from "#src/narration-language-detection.ts";
import type {
  DeclaredLanguage,
  NarrationLanguageDetectionConfig,
  NarrationLanguageFallbackReason,
} from "#src/narration-language-detection.ts";

import { asJsonRecord } from "#test/evals/narration-content-selection-harness.ts";

export type NarrationLanguageDetectionCandidate = NarrationLanguageDetectionConfig & {
  name: string;
  role: "production" | "experiment";
};

export type NarrationLanguageDetectionEvalInput = {
  caseId: string;
  sourceTitle: string;
  /** The narration source material rebuilt from the case's committed selection golden. */
  sourceMaterialHtml: string;
  declaredLanguage?: DeclaredLanguage;
};

export type NarrationLanguageDetectionEvalOutput = {
  /** The language subtag of the detected narration language, without the region rule's region. */
  language?: string;
  fallbackReason?: NarrationLanguageFallbackReason;
};

export function createNarrationLanguageDetectionHarness(
  candidate: NarrationLanguageDetectionCandidate,
) {
  return createHarness<NarrationLanguageDetectionEvalInput, NarrationLanguageDetectionEvalOutput>({
    name: candidate.name,
    run: async ({ input, setArtifact }) => {
      const startedAt = performance.now();
      const responses: SelectionCompletionResponse[] = [];
      const detectNarrationLanguage = createNarrationLanguageDetector({
        ...candidate,
        completion: async (request, options) => {
          const response = await candidate.completion(request, options);
          responses.push(response);
          return response;
        },
      });

      setArtifact("caseId", input.caseId);
      setArtifact("candidateName", candidate.name);
      setArtifact("systemPrompt", candidate.systemPrompt);
      setArtifact("tool", JSON.stringify(candidate.tool));
      setArtifact("completionOptions", JSON.stringify(candidate.completionOptions));
      setArtifact("declaredLanguage", JSON.stringify(input.declaredLanguage ?? {}));

      const result = await detectNarrationLanguage({
        sourceTitle: input.sourceTitle,
        sourceMaterialHtml: input.sourceMaterialHtml,
        ...(input.declaredLanguage === undefined
          ? {}
          : { declaredLanguage: input.declaredLanguage }),
      });
      const output: NarrationLanguageDetectionEvalOutput = {
        ...(result.narrationLanguage === undefined
          ? {}
          : { language: new Intl.Locale(result.narrationLanguage).language }),
        ...(result.fallbackReason === undefined ? {} : { fallbackReason: result.fallbackReason }),
      };
      const [response] = responses;

      if (result.narrationLanguage !== undefined) {
        setArtifact("narrationLanguage", result.narrationLanguage);
      }

      return {
        output,
        events: createTranscriptEvents(input, output, responses),
        ...(response === undefined
          ? {}
          : {
              usage: {
                provider: response.provider,
                model: response.model,
                inputTokens: response.usage.inputTokens,
                outputTokens: response.usage.outputTokens,
                ...(response.usage.reasoningTokens === undefined
                  ? {}
                  : { reasoningTokens: response.usage.reasoningTokens }),
                totalTokens: response.usage.totalTokens,
                toolCalls: response.toolCalls.length,
                retries: 0,
                metadata:
                  response.usage.estimatedCostUsd === undefined
                    ? {}
                    : { estimatedCostUsd: response.usage.estimatedCostUsd },
              },
            }),
        timings: { totalMs: performance.now() - startedAt },
      };
    },
  });
}

function createTranscriptEvents(
  input: NarrationLanguageDetectionEvalInput,
  output: NarrationLanguageDetectionEvalOutput,
  responses: readonly SelectionCompletionResponse[],
): TranscriptEvent[] {
  const toolCallEvents = responses.flatMap((response) =>
    response.toolCalls.map((toolCall): TranscriptEvent => ({
      type: "tool_call",
      id: toolCall.id,
      name: toolCall.name,
      arguments: asJsonRecord(toolCall.arguments),
    })),
  );

  return [
    { type: "message", role: "user", content: input.sourceMaterialHtml },
    ...toolCallEvents,
    { type: "message", role: "assistant", content: output },
  ];
}
