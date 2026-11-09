import {
  createContentSelector,
  type SelectionCompletion,
  type SelectionConfig,
} from "#src/narration-content-selection.ts";
import { SOURCE_ELEMENT_ID_ATTRIBUTE } from "#src/source-element-selection.ts";

const TOOL_NAME = "select_narration_content";
const SOURCE_ELEMENT_ID_PATTERN = new RegExp(`${SOURCE_ELEMENT_ID_ATTRIBUTE}="([^"]+)"`, "gu");

export type FakeNarrationContentSelectorOptions = {
  failure?: Error;
};

/** Creates a deterministic selector that keeps every annotated source element. */
export function createFakeNarrationContentSelector(
  options: FakeNarrationContentSelectorOptions = {},
) {
  const completion: SelectionCompletion = async (request) => {
    if (options.failure) {
      throw options.failure;
    }

    const elementIds = [
      ...new Set(
        [...request.userPrompt.matchAll(SOURCE_ELEMENT_ID_PATTERN)].map((match) => match[1]!),
      ),
    ];

    return {
      provider: "fake",
      model: "deterministic-element-selection",
      toolCalls: [
        {
          id: "fake-selection-call",
          name: TOOL_NAME,
          arguments: { element_ids: elementIds },
        },
      ],
      stopReason: "toolUse",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    };
  };
  const configuration = {
    completion,
    systemPrompt: "Select every annotated element for deterministic local testing.",
    tool: {
      name: TOOL_NAME,
      description: "Return every supplied source element ID.",
      parameters: {
        type: "object",
        properties: {
          element_ids: { type: "array", items: { type: "string" } },
        },
        required: ["element_ids"],
        additionalProperties: false,
      },
    },
    completionOptions: {
      maxTokens: 512,
      maxRetries: 0,
    },
  } satisfies SelectionConfig;

  return createContentSelector(configuration);
}
