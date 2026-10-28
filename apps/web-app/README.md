# Web app

## What it does

- provides the React UI for submitting a source URL
- keeps the web source in `src/`
- uses TanStack Form for typed form state and URL validation
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

[Web application screens](../../docs/architecture/web-app.md) describes the routes and redirects, the Add dialog's masked route, Recents and its masonry grid, the detail view and the account chrome.

The shared bundle includes a CSP nonce placeholder. The API server replaces it with a fresh nonce per HTML response; Capacitor serves the same bundle locally without the server's CSP header.

## Manual verification checklist

- run the build and confirm it succeeds
- open the web app in a browser
- submit an empty or malformed URL and confirm the form shows an inline validation message

## Component tests and visual coverage

Route stories in `src/routes/*.story.tsx` render the application with deterministic MSW responses. Component tests cover the landing page, Recents and its Add dialog, open trial, URL validation, pending submission, trial errors, conversion progress and failure, and audiobook results and errors on desktop and mobile. The E2E suite keeps one screenshot assertion for the open-trial URL input screen.

Run the component tests from the repository root:

```sh
pnpm --filter '@cup/web-app' test:components
```

After intentional visual changes, regenerate the Docker baselines and review the images under `apps/web-app/snapshots`:

```sh
pnpm --filter '@cup/web-app' test:components --update-snapshots
```

Each run starts its own gallery server on a port the operating system assigns. It never attaches to a gallery that is already running, so runs in several checkouts do not interfere with each other or with an interactive gallery.

Explore the stories with `pnpm --filter '@cup/web-app' dev:gallery`, which serves the gallery at <http://127.0.0.1:3100/ui-gallery/index.html>. The gallery opens on a grid with a live thumbnail of every story, grouped by story file; select a thumbnail to open that story at full size. An opened story shows a strip of thumbnails for the other stories in the same file, which switches between them in place.
