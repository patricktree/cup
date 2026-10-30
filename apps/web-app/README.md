# Web app

## What it does

- provides the React UI for submitting a source URL and listening
- models client lifecycles with real modes and cancellable async work, such as account auth, as XState machines ([ADR 0009](../../docs/adr/0009-use-xstate-for-client-lifecycle-state-machines.md))
- initializes native listeners and renders the app from `src/bootstrap.tsx`
- builds the shared SPA bundle consumed by `apps/cloudflare-worker` and `apps/mobile-app`

## Development

From the repo root:

```sh
pnpm --filter '@cup/cloudflare-worker' dev
```

The Worker package owns the Vite development server and handles the web app under `/app/` and API requests under `/api/`, including live reload for the web source.

`/` temporarily redirects to `/app/` (302); `/app` redirects to `/app/` (308). Previously issued `/trials/:grantId` links permanently redirect to `/app/trials/:grantId` (308), preserving query parameters and allowing browsers to carry the credential fragment forward. Old conversion and audiobook page URLs return 404.

## Build

From the repo root:

```sh
pnpm --filter '@cup/cloudflare-worker' build
```

Turbo builds the web package once, then the Worker build copies that bundle as static assets without compiling the SPA again. The build produces:

- `apps/web-app/dist/types`
- `apps/web-app/dist/web` — the shared SPA bundle, also consumed by Capacitor
- `apps/cloudflare-worker/dist/client` — a copy of the shared SPA bundle
- `apps/cloudflare-worker/dist/create_audiobook_from_url` — the Worker bundle and deployment configuration

The router uses `/app` as its base path. Generated JavaScript, CSS, and fonts live under `app/assets/`, and app favicons live under `app/`. Vite keeps the bundle base at `/` so these physical paths work in both Workers and Capacitor without rewriting asset URLs. Domain association files remain under `.well-known/`. The Worker serves the root `index.html` internally for application routes; missing assets and unrelated paths return 404.

[Web application screens](../../docs/architecture/web-app.md) describes the routes and navigation and the Recents layout.

The shared bundle includes a CSP nonce placeholder. The API server replaces it with a fresh nonce per HTML response; Capacitor serves the same bundle locally without the server's CSP header.

## Manual verification checklist

- run the build and confirm it succeeds
- open the web app in a browser
- submit an empty or malformed URL and confirm the form shows an inline validation message

## Component tests and visual coverage

Route stories in `src/routes/*.story.tsx` render the application with deterministic MSW responses, and the component tests screenshot them on desktop and mobile. The [E2E suite](../../qa/e2e/README.md#update-screenshots) keeps only one screenshot assertion.

MSW's service worker answers the stories' requests, so `page.route` never sees them; a story holds a response with its own handler, such as `delay("infinite")`. To hold or fail a response only for part of a test, such as a revisit's refetch, the handler awaits `waitWhileHeld(name)` and answers `readFailedStoryResponse(name)` from [`src/ui-gallery/held-responses.ts`](src/ui-gallery/held-responses.ts), and the test calls `holdResponses`, `releaseResponses` and `failResponses` from [`src/test-utils/held-responses.ts`](src/test-utils/held-responses.ts). A test that guards against a loading flash calls [`recordLoadingStates`](../../qa/loading-state-recorder/README.md) before mounting and asserts on the record ([loading states](../../docs/architecture/web-app.md#loading-states)).

The [query cache](../../docs/architecture/web-app.md#query-cache) and [route loading](../../docs/architecture/web-app.md#where-screens-load) are guarded in [`_shell.recent.test.ts`](src/routes/_shell.recent.test.ts) (revisits of Recents, a track and both dialogs, revisit refetches answered with 404, 403 or 500, a first visit under a paused clock, viewport preloading, the cold start and signed-out redirects) and [`_shell.audiobooks.$conversionId.test.ts`](src/routes/_shell.audiobooks.$conversionId.test.ts) (what a revisit shows after each direct cache edit). A revisit test holds the refetch until it has checked the cached content. Suspense keeps a query without an observer cached for at least one second whatever its `gcTime`, so a revisit test installs a [Playwright clock](https://playwright.dev/docs/clock) and advances it past that before the revisit; one that leaves Recents for a screen still observing the history, such as the detail view, does not guard the cache lifetime, so Recents' own revisit leaves for account recovery.

Run the component tests from the repository root:

```sh
pnpm --filter '@cup/web-app' test:components
```

After intentional visual changes, regenerate the Docker baselines and review the images under `apps/web-app/snapshots`:

```sh
pnpm --filter '@cup/web-app' test:components --update-snapshots
```

Each run starts its own gallery server on a port the operating system assigns. It never attaches to a gallery that is already running, so runs in several checkouts do not interfere with each other or with an interactive gallery.

Explore the stories with `pnpm --filter '@cup/web-app' dev:gallery`, which serves the gallery at <http://127.0.0.1:3100/ui-gallery/index.html>.
