import { OpenAI } from "openai";

import type {
  SelectionCompletion,
  SelectionCompletionResponse,
} from "#src/narration-content-selection.ts";

export const completeWithGemini: SelectionCompletion = async (request, options = {}) => {
  const environment = options.env ?? process.env;
  const accountId = environment["CLOUDFLARE_ACCOUNT_ID"];
  const apiKey = options.apiKey ?? environment["CLOUDFLARE_API_KEY"];
  if (!accountId || !apiKey)
    throw new Error("Narration selection requires Cloudflare account ID and API key");
  const client = new OpenAI({
    apiKey,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/default/google-ai-studio/v1beta/openai`,
    maxRetries: options.maxRetries ?? 0,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    defaultHeaders: {
      // The gateway supplies the stored Google credential; do not forward the Cloudflare token to Google.
      Authorization: null,
      "cf-aig-authorization": `Bearer ${apiKey}`,
      "cf-aig-collect-log": "true",
      "cf-aig-collect-log-payload": "false",
      ...(options.gatewayMetadata
        ? { "cf-aig-metadata": JSON.stringify(options.gatewayMetadata) }
        : {}),
    },
  });
  const response = await client.chat.completions.create(
    {
      model: "gemini-3.8-flash",
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_tokens: options.maxTokens ?? 4096,
      reasoning_effort: options.reasoningEffort ?? "low",
      tools: [{ type: "function", function: request.tool }],
      tool_choice: { type: "function", function: { name: request.tool.name } },
    },
    { signal: options.signal },
  );
  return parseGeminiResponse(response);
};

function parseGeminiResponse(
  response: OpenAI.Chat.Completions.ChatCompletion,
): SelectionCompletionResponse {
  const candidate = response.choices[0];
  const usage = response.usage;
  if (!candidate || !usage)
    throw new Error("Gemini response is missing a candidate or token usage");
  const toolCalls = (
    candidate.finish_reason === "tool_calls" ? (candidate.message.tool_calls ?? []) : []
  ).map((toolCall) => {
    if (toolCall.type !== "function") throw new Error("Gemini returned an unsupported tool call");
    return {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments) as unknown,
    };
  });
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const input = usage.prompt_tokens - cached;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  // OpenAI-compatible completion tokens already include reasoning tokens.
  const output = usage.completion_tokens;
  return {
    provider: "google-ai-studio",
    model: "gemini-3.8-flash",
    responseModel: response.model,
    responseId: response.id,
    toolCalls,
    stopReason:
      candidate.finish_reason === "length"
        ? "length"
        : candidate.finish_reason === "tool_calls" && toolCalls.length > 0
          ? "toolUse"
          : "error",
    rawStopReason: candidate.finish_reason,
    errorMessage: `Gemini finished with ${candidate.finish_reason}`,
    usage: {
      inputTokens: input,
      outputTokens: output,
      ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
      cacheReadTokens: cached,
      totalTokens: usage.total_tokens,
      estimatedCostUsd: (input * 0.75 + cached * 0.075 + output * 3.75) / 1_000_000,
    },
  };
}
