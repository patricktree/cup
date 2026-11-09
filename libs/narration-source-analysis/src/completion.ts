/*
 * The model call behind narration source analysis: one forced tool call per request. Narration
 * content selection and narration language detection share it.
 */

export type CompletionTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type CompletionRequest = {
  systemPrompt: string;
  userPrompt: string;
  tool: CompletionTool;
};

export type CompletionOptions = {
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  maxTokens?: number;
  maxRetries?: number;
};

export type CompletionCallOptions = CompletionOptions & {
  signal?: AbortSignal;
  apiKey?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  gatewayMetadata?: Record<string, string | number>;
};

export type CompletionToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type CompletionCostEstimateBasis = {
  currency: "USD";
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  pricingSource: string;
};

export type CompletionUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
  costEstimateBasis?: CompletionCostEstimateBasis;
};

export type CompletionResponse = {
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  toolCalls: readonly CompletionToolCall[];
  stopReason: "toolUse" | "length" | "stop" | "error" | "aborted";
  rawStopReason?: string;
  errorMessage?: string;
  usage: CompletionUsage;
};

export type Completion = (
  request: CompletionRequest,
  options?: CompletionCallOptions,
) => Promise<CompletionResponse>;
