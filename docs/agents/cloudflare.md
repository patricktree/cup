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

For design changes, consult the current best-practice documentation:

- Durable Objects: <https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/>
- Workflows: <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
