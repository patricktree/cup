import { createHarness, toJsonValue } from "vitest-evals";
import type { JsonValue, TranscriptEvent } from "vitest-evals";

import { createNarrationDocument } from "@cup/narration-document-creation";
import type { SynchronizationUnit } from "@cup/narration-document-creation";

import { runSelection } from "#src/narration-content-selection.ts";
import type { SelectionConfig } from "#src/narration-content-selection.ts";

import type { CaseMetadata } from "#test/evals/eval-cases.ts";

export type NarrationContentSelectionCandidate = SelectionConfig & {
  name: string;
  role: "production" | "experiment";
};

export type NarrationContentSelectionEvalInput = {
  sourceTitle: string;
  sourceSubtitle?: string;
  caseId: string;
  inputHtml: string;
  metadata?: CaseMetadata;
};

export type NarrationContentSelectionEvalOutput = {
  selectedElementIds: string[];
  synchronizationUnits: SynchronizationUnit[];
};

export function createNarrationContentSelectionHarness(
  candidate: NarrationContentSelectionCandidate,
) {
  return createHarness<NarrationContentSelectionEvalInput, NarrationContentSelectionEvalOutput>({
    name: candidate.name,
    run: async ({ input, signal, setArtifact }) => {
      const startedAt = performance.now();

      setArtifact("caseId", input.caseId);
      setArtifact("candidateName", candidate.name);
      setArtifact("systemPrompt", candidate.systemPrompt);
      setArtifact("tool", JSON.stringify(candidate.tool));
      setArtifact("completionOptions", JSON.stringify(candidate.completionOptions));

      if (input.metadata) {
        setArtifact("caseMetadata", input.metadata);
      }

      const selection = await runSelection({
        configuration: candidate,
        sourceMaterialHtml: input.inputHtml,
        ...(signal ? { signal } : {}),
      });
      const narrationDocument = createNarrationDocument({
        sourceTitle: input.sourceTitle,
        ...(input.sourceSubtitle === undefined ? {} : { sourceSubtitle: input.sourceSubtitle }),
        sourceMaterialHtml: selection.selectedSourceMaterialHtml,
      });
      const output = {
        selectedElementIds: [...selection.selectedElementIds],
        synchronizationUnits: narrationDocument.synchronizationUnits.map((unit) => ({ ...unit })),
      };
      const firstResponse = selection.responses[0];

      if (!firstResponse) {
        throw new Error("Expected narration content selection to produce at least one response");
      }

      if (
        selection.responses.some(
          (response) =>
            response.provider !== firstResponse.provider || response.model !== firstResponse.model,
        )
      ) {
        throw new Error(
          "Expected every narration content selection response to use one provider and model",
        );
      }

      const usage = selection.responses.reduce(
        (total, response) => ({
          inputTokens: total.inputTokens + response.usage.inputTokens,
          outputTokens: total.outputTokens + response.usage.outputTokens,
          reasoningTokens: total.reasoningTokens + (response.usage.reasoningTokens ?? 0),
          totalTokens: total.totalTokens + response.usage.totalTokens,
          cacheReadTokens: total.cacheReadTokens + (response.usage.cacheReadTokens ?? 0),
          cacheWriteTokens: total.cacheWriteTokens + (response.usage.cacheWriteTokens ?? 0),
          estimatedCostUsd: total.estimatedCostUsd + (response.usage.estimatedCostUsd ?? 0),
        }),
        {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
        },
      );
      const hasReasoningUsage = selection.responses.some(
        (response) => response.usage.reasoningTokens !== undefined,
      );
      const hasCacheReadUsage = selection.responses.some(
        (response) => response.usage.cacheReadTokens !== undefined,
      );
      const hasCacheWriteUsage = selection.responses.some(
        (response) => response.usage.cacheWriteTokens !== undefined,
      );
      const hasEstimatedCost = selection.responses.some(
        (response) => response.usage.estimatedCostUsd !== undefined,
      );

      setArtifact("provider", firstResponse.provider);
      setArtifact("model", firstResponse.model);
      setArtifact("chunkCount", selection.chunkCount);
      setArtifact("responseCount", selection.responses.length);
      setArtifact("selectedElementCount", selection.selectedElementIds.length);
      setArtifact("synchronizationUnitCount", narrationDocument.synchronizationUnits.length);

      return {
        output,
        events: createTranscriptEvents(input, output, selection.responses),
        usage: {
          provider: firstResponse.provider,
          model: firstResponse.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ...(hasReasoningUsage ? { reasoningTokens: usage.reasoningTokens } : {}),
          totalTokens: usage.totalTokens,
          toolCalls: selection.responses.reduce(
            (count, response) => count + response.toolCalls.length,
            0,
          ),
          retries: selection.responses.length - selection.chunkCount,
          metadata: {
            ...(hasCacheReadUsage ? { cacheReadTokens: usage.cacheReadTokens } : {}),
            ...(hasCacheWriteUsage ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
            ...(hasEstimatedCost ? { estimatedCostUsd: usage.estimatedCostUsd } : {}),
          },
        },
        timings: { totalMs: performance.now() - startedAt },
      };
    },
  });
}

function createTranscriptEvents(
  input: NarrationContentSelectionEvalInput,
  output: NarrationContentSelectionEvalOutput,
  responses: Awaited<ReturnType<typeof runSelection>>["responses"],
): TranscriptEvent[] {
  const toolCallEvents = responses.flatMap((response, responseIndex) =>
    response.toolCalls.map((toolCall): TranscriptEvent => ({
      type: "tool_call",
      id: toolCall.id,
      name: toolCall.name,
      arguments: asJsonRecord(toolCall.arguments),
      metadata: { responseIndex },
    })),
  );

  return [
    { type: "message", role: "user", content: input.inputHtml },
    ...toolCallEvents,
    { type: "message", role: "assistant", content: output },
  ];
}

function asJsonRecord(value: unknown): Record<string, JsonValue> {
  const jsonValue = toJsonValue(value);

  if (jsonValue === undefined) {
    throw new Error("Expected selection tool arguments to be JSON-serializable");
  }

  if (jsonValue === null || typeof jsonValue !== "object" || Array.isArray(jsonValue)) {
    throw new Error("Expected selection tool arguments to be a JSON object");
  }

  return jsonValue;
}
