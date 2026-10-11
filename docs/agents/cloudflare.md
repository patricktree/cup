# Cloudflare documentation

Consult current official Cloudflare documentation before making decisions that depend on runtime behavior, configuration syntax, compatibility, limits, or quotas.

| Product           | Documentation                                              |
| ----------------- | ---------------------------------------------------------- |
| Workers           | <https://developers.cloudflare.com/workers/>               |
| Static Assets     | <https://developers.cloudflare.com/workers/static-assets/> |
| Workflows         | <https://developers.cloudflare.com/workflows/>             |
| Durable Objects   | <https://developers.cloudflare.com/durable-objects/>       |
| R2                | <https://developers.cloudflare.com/r2/>                    |
| AI Gateway        | <https://developers.cloudflare.com/ai-gateway/>            |
| Browser Rendering | <https://developers.cloudflare.com/browser-rendering/>     |

Narration selection and speech synthesis use Google AI Studio through AI Gateway. Keep the Wrangler `AI` binding: speech synthesis uses `env.AI.gateway(...).run(...)` to access AI Gateway, even though the application does not use Workers AI models. See [AI Gateway Worker bindings](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/).

## Provider rate limits

AI Gateway authenticates to Google with a Google AI Studio key stored in the gateway, so the limits of that key’s Google project apply. Google counts them per project, across every Cup user, as requests per minute, input tokens per minute, and requests per day, plus a spend limit per rolling 10 minutes on paid tiers. The gateway adds limits only if rate limiting is configured on it.

Google publishes each model’s limits only in the [AI Studio rate-limit dashboard](https://aistudio.google.com/rate-limit), which requires Patrick’s Google login: ask him for the current values, naming the model from the [speech configuration](../../libs/audiobook-production/src/speech-synthesis-config.ts). The public [rate-limit page](https://ai.google.dev/gemini-api/docs/rate-limits) explains tiers but omits the TTS models. [ADR 0008](../adr/0008-synthesize-the-whole-narration-document.md) records the values observed on 2026-10-11, and that the displayed project was not confirmed to own the stored key.

For design changes, consult the current best-practice documentation:

- Durable Objects: <https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/>
- Workflows: <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
