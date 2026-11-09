---
status: accepted
---

# Use Gemini Flash through AI Gateway for narration content selection

On 2026-09-08, choose `gemini-3.8-flash` through Cloudflare AI Gateway and its stored Google AI Studio credential for production narration content selection. It preserved the expected narration text in every tested case and completed substantially faster than the previous Qwen configuration. Keep the existing selection contract: the model returns source element IDs, and application code reconstructs narration source material from the original elements, preserving wording and structure.

On 2026-11-09 ([patricktree/cup#216](https://github.com/patricktree/cup/issues/216)), this decision also covers narration language detection, which calls the same model through the same adapter at minimal reasoning effort.

## Evidence and alternatives

The benchmark used the committed Cloudflare Kitesurf HTML (approximately 93 KB), the element-ID selection prompt, and repeated live requests. Measurements are small samples, not latency guarantees; tokenizers, thinking controls, caching, streaming, and serving providers differed. No golden files were relaxed to accept model differences.

| Model and serving path                              | Full-page completion time             | Observed quality                                                              |
| --------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| Gemini 3.8 Flash through AI Gateway, low thinking   | 4.2–10.8 seconds across repeated runs | Exact narration-text matches                                                  |
| DeepSeek V4 Flash 0731 on Workers AI, low reasoning | 50.8 seconds                          | Exact match                                                                   |
| DeepSeek through OpenRouter                         | 18.4–20.9 seconds                     | DeepInfra matched; Relace omitted two paragraphs                              |
| Qwen 3.8 27B through OpenRouter/Reka                | 13.7–22.1 seconds                     | Duplicated the title                                                          |
| Qwen through QwenCloud, thinking enabled            | 66.3 seconds on the successful run    | Duplicated the title; another run was blocked by the provider's output filter |
| Qwen through QwenCloud, thinking disabled           | 8.5–19.0 seconds                      | Duplicated the title                                                          |
| Qwen on Workers AI, thinking disabled               | 15.0–18.2 seconds                     | Duplicated the title                                                          |

Earlier Qwen requests repeatedly reached the 120-second request deadline, including a full-page request with a simple text-extraction prompt. Explicitly disabling thinking on Workers AI produced zero reasoning content and much faster completions. Therefore the evidence does not establish Workers AI infrastructure as the sole cause: model reasoning configuration materially affected latency. `reasoning_effort: low` is not equivalent to disabling thinking. QwenCloud also rejected required tool calls with thinking enabled, so its thinking-mode benchmark used automatic tool choice.

Gemini passed the complete three-case suite through the repository eval harness twice, with exact synchronization-unit matches: Anthropic in 5.9 and 19.9 seconds, Cloudflare in 4.6 and 6.2 seconds, and derStandard in 4.1 and 2.3 seconds. These runs used the existing five/five/one chunk layout. After promoting the adapter to production, the production eval suite also passed exactly in 6.5, 24.2, and 14.2 seconds, illustrating the variability of live latency. DeepSeek on Workers AI also passed all three cases, in 39.4, 24.4, and 11.9 seconds. GPT-5.6 Luna was considered on price but not benchmarked; Hugging Face was investigated but not tested without credentials.

## Cost and consequences

At the measured 32,751 input and 588 output tokens, uncached Gemini selection cost approximately $0.0268. At identical token counts, Qwen's listed rates imply $0.0166, but actual output and reasoning usage differ. This small per-article premium is accepted for the measured latency and selection quality. Audio synthesis cost is separate.

Google lists standard pricing of $0.75 per million input tokens, $0.075 per million cached input tokens, and $3.75 per million output tokens including thinking through December 31, 2026; the announced rates double on January 1, 2027. Cost estimates must be reviewed when pricing changes. Exact-match evals remain the release gate, and provider or prompt changes must rerun them. No automatic fallback to a different model is introduced because the tested alternatives did not consistently select equivalent content.

Sources: [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Qwen thinking controls](https://huggingface.co/Qwen/Qwen3.8-27B), and [QwenCloud thinking](https://docs.qwencloud.com/developer-guides/text-generation/thinking).
