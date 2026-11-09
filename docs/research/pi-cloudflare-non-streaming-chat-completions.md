# Pi and Cloudflare non-streaming Chat Completions

Research date: 2026-08-27

Historical research: this note describes the Pi/Workers AI implementation and alternatives evaluated at that date. Its repository-specific recommendations are superseded by [the Gemini selection decision](../adr/0002-use-gemini-for-narration-content-selection.md). Production narration selection now uses the OpenAI SDK with Google AI Studio through Cloudflare AI Gateway in `libs/narration-source-analysis/src/gemini-completion.ts`.

## Question

Does the latest `@earendil-works/pi-ai` SDK support a one-shot, non-SSE OpenAI-compatible `POST /chat/completions` request through its built-in Cloudflare Workers AI or Cloudflare AI Gateway providers?

In this note, **non-streaming** means one HTTP response with a JSON Chat Completion rather than an SSE response. Cloudflare calls this mode "synchronous," although the JavaScript call still returns a promise and is normally awaited.

## Conclusion

No. Cloudflare supports non-streaming Chat Completions, but Pi's built-in text generation API contract and both Cloudflare provider adapters are streaming-only at the HTTP transport layer.

Pi's `complete()` and `completeSimple()` methods can sound like non-streaming APIs because callers receive one final `AssistantMessage`. Internally, however, they call `stream()` or `streamSimple()` and await the accumulated stream result. The OpenAI Chat Completions adapter always sends `stream: true`.

The custom adapter in `libs/narration-source-analysis/src/production-narration-content-selection.ts` is therefore necessary if this application must use a non-SSE request with Pi's current model and message abstractions. Switching between Pi's built-in Cloudflare Workers AI and Cloudflare AI Gateway providers does not remove that need.

## Versions checked

- This repository declares `@earendil-works/pi-ai` `^0.84.3` and resolves version `0.84.3` in `pnpm-lock.yaml`.
- npm's `latest` dist-tag was `0.84.3`, published on 2026-08-24. The official release is [Pi v0.84.3](https://github.com/earendil-works/pi/releases/tag/v0.84.3).
- The release tag points to commit [`4e58f324`](https://github.com/earendil-works/pi/commit/4e58f324fae8ebfa98a3d45181fb248072a2afac).
- The current `main` branch was also checked at commit [`e8682309`](https://github.com/earendil-works/pi/commit/e86823096c5bad39e1ca282ec24bc5eb9bec745b), dated 2026-08-26. Its relevant provider and transport behavior is unchanged.

Thus the installed package is already the latest release, and using current unreleased `main` would not add non-streaming support.

## Capability matrix

| Layer | One-shot result API | Non-SSE HTTP transport |
| --- | --- | --- |
| Cloudflare Workers AI service | Yes | Yes |
| Cloudflare AI Gateway service | Yes | Yes |
| Pi `Models.complete*()` | Yes | No; it consumes Pi's stream internally |
| Pi Cloudflare Workers AI provider | Yes, via `complete*()` aggregation | No |
| Pi Cloudflare AI Gateway provider | Yes, via `complete*()` aggregation | No |

## Evidence from Pi

### `complete*()` aggregates a stream

At v0.84.3, `Models.complete()` returns `this.stream(...).result()`, while `Models.completeSimple()` returns `this.streamSimple(...).result()`. These methods change how the caller receives the result, not how Pi communicates with the provider. See [`models.ts` lines 682-703](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/models.ts#L682-L703).

Pi's provider contract reinforces this: `ProviderStreams` contains `stream` and `streamSimple`, plus optional deferred-response operations, but no `complete` or non-streaming transport hook. See [`types.ts` lines 264-280](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/types.ts#L264-L280).

The README's `completeSimple()` example therefore describes a complete consumer-facing result, not a non-streaming HTTP request. The implementation is the authoritative distinction.

### The OpenAI Chat Completions adapter forces SSE

Pi's OpenAI Chat Completions adapter builds a `ChatCompletionCreateParamsStreaming` payload with a hard-coded `stream: true`; see [`openai-completions.ts` lines 753-775](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-completions.ts#L753-L775). It passes that payload to `client.chat.completions.create()` and consumes the returned async stream; see [`openai-completions.ts` lines 313-329](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-completions.ts#L313-L329).

Neither `OpenAICompletionsOptions` nor the provider-neutral `StreamOptions` exposes a supported streaming boolean. Pi does expose `samplingParams` and an `onPayload` callback for request customization, but these do not provide a working non-streaming mode: the adapter still expects the returned value to be an async iterable of Chat Completion chunks.

A controlled local probe against the installed package confirmed this. Setting `samplingParams: { stream: false }` changed the outgoing body to `stream: false`, but `completeSimple()` ended with `openaiStream is not async iterable` when given a valid one-shot Chat Completion response. This is consistent with the source and should not be treated as a supported escape hatch.

### Both Cloudflare providers delegate to streaming adapters

The Workers AI provider delegates its only text API to `cloudflareStreams(openAICompletionsApi())`; see [`cloudflare-workers-ai.ts` lines 1-15](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/providers/cloudflare-workers-ai.ts#L1-L15).

The AI Gateway provider supports three API schemas, but all use the same streaming implementations:

- `anthropic-messages`
- `openai-completions`
- `openai-responses`

See [`cloudflare-ai-gateway.ts` lines 1-22](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/providers/cloudflare-ai-gateway.ts#L1-L22).

The `cloudflareStreams()` wrapper only resolves account and gateway placeholders before delegating `stream()` and `streamSimple()`. It adds no completion method or non-SSE route; see [`cloudflare-stream.ts` lines 1-28](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/providers/cloudflare-stream.ts#L1-L28).

The installed AI Gateway catalog also does not currently list `workers-ai/@cf/qwen/qwen3.8-27b`, although that is secondary to the transport issue: manually defining the model would still route it through the same streaming OpenAI Completions adapter.

## Evidence from Cloudflare

The limitation is not imposed by Cloudflare:

- The official [Qwen 3.8 27B model reference](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/) documents separate synchronous and streaming schemas. Its `stream` field is optional for a synchronous response, while `stream: true` selects SSE.
- The official [Workers AI OpenAI compatibility guide](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) documents `/v1/chat/completions` and shows an awaited OpenAI SDK call without enabling streaming.
- The official [AI Gateway unified Chat Completions guide](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/) documents its OpenAI-compatible endpoint and likewise shows one-shot OpenAI SDK usage.
- The current [AI Gateway REST API guide](https://developers.cloudflare.com/ai-gateway/usage/rest-api/) lists `POST /ai/v1/chat/completions` as OpenAI SDK-compatible for both third-party and Workers AI models.

Cloudflare can therefore return exactly the one-shot JSON response parsed by the application's custom adapter.

## Implication for this repository

There is no supported Pi option or alternate built-in Cloudflare provider that can replace the custom adapter while preserving all of these requirements:

1. use `@cf/qwen/qwen3.8-27b` on Cloudflare Workers AI;
2. send `stream: false` to `/chat/completions`;
3. return a Pi `AssistantMessage` with normalized tool calls, usage, stop reason, and cost.

Reasonable paths are:

1. **Keep the focused local adapter.** This is currently the lowest-risk option. It can continue using Pi for model metadata, auth resolution, types, and cost calculation while owning the one-shot request and response conversion.
2. **Contribute non-streaming transport support to Pi.** This requires more than adding an option. Pi would need a provider/API completion contract and a one-shot response parser, or a deliberate bridge that converts one-shot responses into its event stream abstraction.
3. **Use the OpenAI SDK directly for this completion.** Cloudflare officially supports it. The application would still need a small normalization layer to convert the result to Pi's `AssistantMessage`, so this removes request serialization code but not all adapter code.

Merely replacing `models.streamSimple()` with `models.completeSimple()`, setting `samplingParams.stream` to `false`, using `onPayload`, or switching to Pi's Cloudflare AI Gateway provider is not sufficient.

## Vercel AI SDK community Cloudflare AI Gateway provider

The Vercel AI SDK documentation also lists Cloudflare's community [`ai-gateway-provider`](https://ai-sdk.dev/providers/community-providers/cloudflare-ai-gateway). This is a genuine non-streaming option at the transport level, but it is not a clean replacement for this repository's direct Workers AI adapter.

### Version and transport

The latest npm release checked was `ai-gateway-provider` `4.0.0`, published on 2026-07-22. It peers with AI SDK `ai` `^7.0.11` and `@ai-sdk/openai-compatible` `^3.0.3`; see the [`4.0.0` package manifest](https://github.com/cloudflare/ai/blob/fa82946fc5b38813a8149b40f7d24b3e60416ddc/packages/ai-gateway-provider/package.json).

`generateText()` calls the wrapped model's `doGenerate()` method. The community provider first replaces the wrapped provider's fetch function to capture the generated request, then submits the captured request inside a Cloudflare AI Gateway envelope. Once Cloudflare responds, it gives that response back to the same wrapped model for parsing. See [`processModelRequest()`](https://github.com/cloudflare/ai/blob/fa82946fc5b38813a8149b40f7d24b3e60416ddc/packages/ai-gateway-provider/src/index.ts#L78-L256).

For its `unified` model helper, the wrapped provider is AI SDK's generic OpenAI-compatible provider; see [`providers/unified.ts`](https://github.com/cloudflare/ai/blob/fa82946fc5b38813a8149b40f7d24b3e60416ddc/packages/ai-gateway-provider/src/providers/unified.ts#L1-L12). Its `doGenerate()` sends a normal JSON `/chat/completions` request without a `stream` field. Only `doStream()` adds `stream: true`; see [`openai-compatible-chat-language-model.ts`](https://github.com/vercel/ai/blob/73a1457417f53d2978fc055f3035c1e47578cd56/packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts#L327-L445).

Therefore, `generateText()` through this provider really does use a one-shot non-SSE upstream request. This differs from Pi's `completeSimple()`, which merely aggregates an SSE request.

### Which Cloudflare endpoint it uses

`ai-gateway-provider` `4.0.0` does **not** post directly to Cloudflare's current `api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions` endpoint. Its REST path posts an array of provider requests to `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}`. That is Cloudflare's AI Gateway Universal Endpoint; the source URL is visible in [`index.ts`](https://github.com/cloudflare/ai/blob/fa82946fc5b38813a8149b40f7d24b3e60416ddc/packages/ai-gateway-provider/src/index.ts#L126-L187).

Cloudflare has [deprecated the Universal Endpoint](https://developers.cloudflare.com/ai-gateway/usage/universal/) for new integrations. Cloudflare has also [deprecated `/compat/chat/completions` for ordinary single-model calls](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/), although both remain available and `/compat` remains required for dynamic routes.

The package does not expose Workers AI as a native wrapped-provider entry in its documented provider list. It can instead reach Workers AI through its `unified` compatibility helper:

```ts
const model = aigateway(unified("workers-ai/@cf/qwen/qwen3.8-27b"));
```

That helper generates a `/compat/chat/completions` request, which the outer provider places inside the Universal Endpoint envelope as provider `compat`. Cloudflare officially documents the `workers-ai/@cf/...` model naming on the compatibility endpoint. This route should therefore be capable of reaching the required model, assuming appropriate Workers AI or stored-key authentication, but it uses two compatibility layers that Cloudflare no longer recommends for single-model calls.

For new Workers AI integrations, Cloudflare recommends the current [AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/): send `@cf/qwen/qwen3.8-27b` to the account-level `/ai/v1/chat/completions` endpoint and select the gateway with `cf-aig-gateway-id`. That is much closer to the repository's existing custom request than to `ai-gateway-provider`'s Universal Endpoint architecture.

### Tools, reasoning, usage, and retries

For the unified OpenAI-compatible path:

- Function tools and `toolChoice: "required"` are serialized to standard OpenAI-compatible `tools` and `tool_choice`, and returned tool calls are parsed. See [`openai-compatible-prepare-tools.ts`](https://github.com/vercel/ai/blob/73a1457417f53d2978fc055f3035c1e47578cd56/packages/openai-compatible/src/chat/openai-compatible-prepare-tools.ts#L10-L92) and Cloudflare's [tool round-trip test](https://github.com/cloudflare/ai/blob/fa82946fc5b38813a8149b40f7d24b3e60416ddc/packages/ai-gateway-provider/test/tools-structured.test.ts#L46-L91).
- AI SDK reasoning levels are mapped to `reasoning_effort`, and returned `reasoning_content` or `reasoning` is parsed. See [`openai-compatible-chat-language-model.ts`](https://github.com/vercel/ai/blob/73a1457417f53d2978fc055f3035c1e47578cd56/packages/openai-compatible/src/chat/openai-compatible-chat-language-model.ts#L273-L321).
- Token usage and finish reasons are normalized by the AI SDK provider. It does not use Pi's model catalog or `calculateCost()`, so this repository would lose its current Pi cost calculation unless it added another conversion step.
- AI SDK's `generateText()` has its own `maxRetries` option, while `ai-gateway-provider` can also send Cloudflare gateway retry settings through its `retries` configuration. These are not identical to the current adapter's deliberately narrow HTTP 408 retry policy.

Model support remains the upstream service's responsibility. The generic provider can serialize reasoning and tools, and Cloudflare documents both for Qwen 3.8 27B, but `ai-gateway-provider` itself has no model catalog or Qwen-specific compatibility behavior.

### Replacement assessment

Adopting this provider would remove most manual Chat Completions request and response serialization. It would also introduce a broader migration:

1. add AI SDK 7, `ai-gateway-provider`, and its OpenAI-compatible peer packages;
2. configure an AI Gateway and use the deprecated Universal-plus-compat route for this Workers AI model;
3. translate AI SDK results back into Pi `AssistantMessage` values, or refactor `SelectionCompletion`, eval artifacts, usage aggregation, and the Pi eval harness away from Pi;
4. restore cost calculation and align retry and stop-reason semantics.

Consequently, it is a technically viable proof that a maintained SDK can make one-shot tool-calling requests through Cloudflare AI Gateway, but it is not a clean replacement here. The focused local adapter remains smaller and uses Cloudflare's recommended current endpoint. If removing custom protocol code is the priority, a direct OpenAI SDK client pointed at the current Cloudflare REST endpoint is a more direct migration than adopting `ai-gateway-provider` solely for this one Workers AI model.
