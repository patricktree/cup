# Cloudflare Worker

## Commands

| Task            | Command                                                  |
| --------------- | -------------------------------------------------------- |
| Develop locally | `pnpm --filter '@cup/cloudflare-worker' run dev`         |
| Build           | `pnpm --filter '@cup/cloudflare-worker' run turbo:build` |
| Lint            | `pnpm --filter '@cup/cloudflare-worker' run turbo:lint`  |
| Test            | `pnpm --filter '@cup/cloudflare-worker' run test`        |

- Deploy only when the user explicitly requests it.

## Integration tests

- Test whole-Worker behavior here: routing, custom-domain redirects, headers on real responses, web app serving, and requests that must reach real Durable Object bindings. Test request handling with injected dependencies in `libs/api-server/test` instead.
- Start the Worker with `const worker = await useWorker({ onTestFinished })` from `test/use-worker.ts`, passing `onTestFinished` from the test's own context. Each call starts a fresh instance of the production entry (`test/worker.ts` re-exports `src/index.ts`) with empty Durable Object, R2, and Workflow storage, and closes it when that test finishes, so tests in a file run concurrently (`vitest.config.ts`). Override vars or secrets per test with `useWorker(context, { vars, secrets })`.
- Send requests with `worker.fetch(url)`; an absolute URL sets the hostname the Worker sees, such as `https://www.cup-audio.com/` for a redirect or `http://localhost/` for the development operator token.
- `test/wrangler.test.jsonc` mirrors the production bindings without `AI` (Workers AI) and `BROWSER` (Browser Rendering), so code that would call them fails instead of costing money. Its Supabase and Cloudflare Access URLs point at an unreachable local port, and `useWorker()` supplies dummy values for every required secret. Keep tests away from conversions, sign-in, and account deletion, which reach those providers.
- The config lives in `test/` so that Wrangler does not load this package's `.env.local`. It serves the small fixture in `test/assets/` instead of the built web app.
- `test/wrangler-config.test.ts` pins the production `wrangler.jsonc` (custom domains, compatibility, assets, Durable Object bindings and migrations, Workflows, required secrets, observability) and checks that the test config binds the same resources. Update it deliberately when production configuration changes; never rewrite deployed migrations.

## Cloudflare documentation

Before decisions about Cloudflare runtime behavior, configuration, compatibility, limits, quotas, or design, follow the [Cloudflare documentation guidance](../../docs/agents/cloudflare.md).
