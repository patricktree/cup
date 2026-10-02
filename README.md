# Cup

Turns the content behind a URL into natural-sounding narration.

## Product idea

Many news articles, blog posts, and other online texts are worth listening to, even though they were published only as text.

Existing tools are designed for different use cases:

- Screen readers such as VoiceOver are designed for navigating web pages, so they interrupt the listening experience by announcing interface elements such as navigation menus.
- Conventional non-AI read-aloud and voice-over tools sound robotic.

This product

- uses AI to select exactly the parts of a page that a listener would want to hear
- and turns that into natural-sounding narration using the latest Gemini 3.1 Flash TTS model

## Conversion sequence

```text
Source URL
  -> fetch the page content with Playwright through Cloudflare Browser Run
  -> use AI to select the text to narrate (without rewriting anything)
  -> split the selected text into synchronization units (chunks)
  -> generate speech for each synchronization unit
  -> assemble the audio and create synchronization cues
  -> store the canonical audiobook in R2
  -> deliver EPUB 3, MP3, and WebVTT captions
```

Cloudflare Workflows runs the conversion as a durable, long-running process.  
Each stage has an explicit timeout and retry policy, and independently generated audio segments can be retried or reused without restarting the entire conversion.

## Platform architecture

- **Cloudflare Workers** hosts the SPA and the HTTP API.
- **Cloudflare Durable Objects with SQLite** store conversion grants and coordinate their mutable state.
- **Cloudflare Workflows** orchestrates long-running conversions, retries, and terminal outcomes.
- **Cloudflare R2** stores audio segments, assembled MP3 files, audiobook manifests, and generated exports.
- **Cloudflare Zero Trust Access** protects operator routes.
- **Cloudflare AI Gateway** routes Google AI Studio narration selection and text-to-speech requests and records logs and request metadata.

## Technology Stack

| Concern                         | Technologies                                                                           | Role                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Web application                 | React, Base UI, Vite, TanStack Router, TanStack Query, TanStack Form, Linaria CSS      | Renders the SPA and manages routing, server state, forms, and styling                    |
| API                             | Hono, OpenAPI, `@hono/zod-openapi`                                                     | Exposes the HTTP API and validates its request and response schemas                      |
| Page rendering and extraction   | Playwright, Cloudflare Browser Run                                                     | Loads pages, including JavaScript-rendered content, and captures their HTML and metadata |
| Narration content selection     | Cloudflare AI Gateway, Google AI Studio, `gemini-3.8-flash`                            | Selects the original page elements worth narrating                                       |
| Text-to-speech                  | Cloudflare AI Gateway, Google AI Studio text-to-speech, `gemini-3.1-flash-tts-preview` | Routes speech requests and generates an audio segment for each synchronization unit      |
| Conversion orchestration        | Cloudflare Workflows                                                                   | Runs the long-lived conversion with explicit timeouts, retries, and resumable stages     |
| Application state               | Cloudflare Durable Objects, SQLite, Drizzle ORM                                        | Stores conversion grants and coordinates their mutable state                             |
| Object storage                  | Cloudflare R2                                                                          | Stores audio segments, assembled MP3 files, audiobook manifests, and generated exports   |
| Access control and verification | Cloudflare Zero Trust Access, `jose`                                                   | Protects operator routes and verifies Cloudflare Access tokens                           |
| Validation and date/time        | Zod, Temporal                                                                          | Validates structured data and handles date and time values                               |

Cup produces MP3 audio, WebVTT captions, and EPUB 3 documents with Media Overlays.

### Development and Testing

| Concern                          | Technologies                            | Role                                                                   |
| -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Workspace and builds             | pnpm, Turborepo                         | Manages dependencies and orchestrates builds                           |
| Cloudflare development           | Wrangler                                | Runs and deploys the Cloudflare Worker                                 |
| Formatting, type checks, linting | Oxfmt, TypeScript, Oxlint               | Enforces formatting and applies static-analysis (type checks, linting) |
| Tests and evals                  | Vitest, Playwright Test, `vitest-evals` | Covers unit behavior, end-to-end flows, and LLM output quality         |

## Development

See [./AGENTS.md](./AGENTS.md).

See [Social signup operations](docs/social-signup-operations.md) for local Supabase setup, account lifecycle operations, and deployment configuration.
