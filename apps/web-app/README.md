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

The router uses `/app` as its base path. Generated JavaScript, CSS, and fonts live under `app/assets/`, and app favicons live under `app/`. Vite keeps the bundle base at `/` so these physical paths work in both Workers and Capacitor without rewriting asset URLs. The Worker serves the root `index.html` internally for application routes; missing assets and unrelated paths return 404.

[Web application screens](../../docs/architecture/web-app.md) describes the routes and navigation and the Recents layout.

The shared bundle includes a CSP nonce placeholder. The API server replaces it with a fresh nonce per HTML response; Capacitor serves the same bundle locally without the server's CSP header.

## Manual verification checklist

- run the build and confirm it succeeds
- open the web app in a browser
- submit an empty or malformed URL and confirm the form shows an inline validation message

## Component tests and visual coverage

Route stories in `src/routes/*.story.tsx` render the application with deterministic MSW responses, and the component tests screenshot them on desktop and mobile in Chromium and WebKit ([browser projects](#browser-projects-and-the-visual-tag)). The browsers reach the gallery through their connection to the [Docker Playwright Server](../../.patricktree-stack/tooling/config-playwright/README.md) (`exposeNetwork` in [`playwright.config.ts`](playwright.config.ts)): on Docker Desktop for macOS about 2–10% of new connections from the container to the host never completed, and WebKit, unlike Chromium, opens no second connection, so its gallery navigations stalled. The [app E2E suite](../../qa/e2e/README.md) connects directly, because in it the tunnel made 7 of 60 runs of three tests fail, against none without it (2026-11-09, Playwright 1.65.0). The [E2E suite](../../qa/e2e/README.md#update-screenshots) keeps only a few screenshot assertions.

MSW's service worker answers the stories' requests, so `page.route` never sees them; a story holds a response with its own handler, such as `delay("infinite")`. A story's narration track is a `data:` URL of a generated silent WAV rather than a handler's response ([`src/ui-gallery/narration-track.ts`](src/ui-gallery/narration-track.ts)), because MSW drops a media request's `Range` header and browsers seek only in media served with byte ranges. It is not a `blob:` URL, because WebKit's GStreamer media backend on Linux intermittently failed to load a blob while it detected the track's format. To hold or fail a response only for part of a test, such as a revisit's refetch, the handler awaits `waitWhileHeld(name)` and answers `readFailedStoryResponse(name)` from [`src/ui-gallery/held-responses.ts`](src/ui-gallery/held-responses.ts), and the test calls `holdResponses`, `releaseResponses` and `failResponses` from [`src/test-utils/held-responses.ts`](src/test-utils/held-responses.ts). A test that guards against a loading flash calls [`recordLoadingStates`](../../qa/loading-state-recorder/README.md) before mounting and asserts on the record ([loading states](../../docs/architecture/web-app.md#loading-states)).

The [query cache](../../docs/architecture/web-app.md#query-cache) and [route loading](../../docs/architecture/web-app.md#where-screens-load) are guarded in [`_shell.recent.test.ts`](src/routes/_shell.recent.test.ts) (revisits of Recents, a track and both dialogs, revisit refetches answered with 404, 403 or 500, a first visit under a paused clock, viewport preloading, the cold start and signed-out redirects) and [`_shell.audiobooks.$conversionId.test.ts`](src/routes/_shell.audiobooks.$conversionId.test.ts) (what a revisit shows after each direct cache edit). A revisit test holds the refetch until it has checked the cached content. Suspense keeps a query without an observer cached for at least one second whatever its `gcTime`, so a revisit test installs a [Playwright clock](https://playwright.dev/docs/clock) and advances it past that before the revisit; one that leaves Recents for a screen still observing the history, such as the detail view, does not guard the cache lifetime, so Recents' own revisit leaves for account recovery.

Run the component tests from the repository root:

```sh
pnpm --filter '@cup/web-app' test:components
```

After intentional visual changes, regenerate the Docker baselines and review the images under `apps/web-app/snapshots`:

```sh
pnpm --filter '@cup/web-app' test:components --update-snapshots
```

These baselines come from the implementation, so they cannot show that a screen matches its design. The [fidelity check](../../qa/fidelity-check/README.md) compares a story with the design's image.

Each run builds the gallery into `playwright-output/gallery` (`build:gallery`, about 1 s) and serves the build with Vite's preview server on a port the operating system assigns (`webServer` in [`playwright.config.ts`](playwright.config.ts)). It never attaches to a gallery that is already running, so runs in several checkouts do not interfere with each other or with an interactive gallery. The build uses React's development build, so tests still see React's warnings and Strict Mode's double renders. A test that imports a source module into the page by its path, such as `import("/src/platform/share-intake.ts")`, gets the instance the stories use: the build emits every source module under its own path, and the preview server answers the `.ts` path with it ([`ui-gallery/vite.config.ts`](ui-gallery/vite.config.ts)).

Explore the stories with `pnpm --filter '@cup/web-app' dev:gallery`, which serves the gallery at <http://127.0.0.1:3100/ui-gallery/index.html>.

### Browser projects and the visual tag

The component tests run in four Playwright projects, but not every test runs in all four ([ADR 0025](../../docs/adr/0025-run-only-visual-component-tests-in-all-four-browser-projects.md)):

- **Desktop Chromium and mobile WebKit run every test**, so each behaviour meets both engines and both viewports.
- **Mobile Chromium and desktop WebKit run only tests tagged `@visual`** (`grep` in [`playwright.config.ts`](playwright.config.ts)).

Tag a test with `test(title, { tag: VISUAL_TAG }, body)`, importing `VISUAL_TAG` from [`src/test-utils/component-test.ts`](src/test-utils/component-test.ts), when it asserts a screenshot, or when its behaviour depends on the engine or the viewport:

- view transitions, such as the cover transition between Recents and the detail view;
- pointer and touch input, such as pulling the Add dialog's grabber or pressing a point of the mini player;
- layout measured against the viewport, such as horizontal overflow, the Add dialog's geometry, the masonry's order and scrolling;
- animations, such as the Add dialog sliding in and out, and reduced motion;
- playback of the narration track, whose `data:` URL works around WebKit's media backend (see above).

Every other test, including the pure-logic files, runs in the two projects. Test files import `test` and `expect` from [`src/test-utils/component-test.ts`](src/test-utils/component-test.ts), not from `@playwright/test` (lint enforces it): its `toHaveScreenshot` fails a test without the tag with a message naming it, so a screenshot cannot lose two of its four projects by accident.

### Runtime

Measured on an Apple M4 Max (14 cores, 36 GB) on 2026-11-12 with the Mac otherwise idle, uncached (`pnpm turbo run turbo:test --filter=@cup/web-app --force`, which also rebuilds the packages the web app depends on):

| Setup                                                     | Test runs | Playwright | `turbo:test` |
| --------------------------------------------------------- | --------- | ---------- | ------------ |
| Every test in four projects, 4 workers                    | 1,372     | 7 min 44 s | 7 min 50 s   |
| Visual tests in four projects, the rest in two, 8 workers | 846       | 4 min 56 s | 5 min 0 s    |
| As above, the gallery served from a build                 | 846       | 2.2 min    | 2 min 15 s   |

The last row is the current setup, measured on 2026-11-13 against the development server on the same machine ([#307](https://github.com/patricktree/cup/issues/307)). Three runs serving the gallery from the Vite development server took 4 min 54 s, 4 min 47 s and 4 min 46 s; six runs serving it from a build took 2 min 15 s, 2 min 16 s, 2 min 15 s, 2 min 16 s, 2 min 17 s and 2 min 15 s. Every screenshot matched its baseline unchanged. The second development server run failed two desktop WebKit tests whose Add dialog top edges moved back up in their last frames: "a press outside slides the Add dialog away…" and "Pulling the grabber down slides the Add dialog away…". Two build runs each failed one desktop WebKit test of the same kind: "a successful start closes the Add dialog and lists the new item" and "the Add dialog slides up from the bottom edge as it opens". The build also ends a failure the development server caused: a hot update from the CSS that wyw-in-js extracts re-ran the gallery's entry module in an open test page, whose second `worker.start()` failed as MSW's worker was already started (a trace of #306's failing run requested `main.tsx?t=…`). A build has no hot updates.

The worker count in [`playwright.config.ts`](playwright.config.ts) is the one with the lowest wall-clock time that passed three consecutive runs without a timeout. Single runs of the new setup took 5 min 15 s at 4 workers (one test failed as the gallery's MSW worker reported itself already started; see above), 4 min 54 s at 6 and 4 min 49 s at 8; three consecutive runs at 8 workers then passed in 4 min 54 s, 4 min 53 s and 4 min 56 s. At 10 workers a run took 5 min 9 s and at 12 workers 5 min 53 s, and each failed one test (at 12 workers the Add dialog's slide-away sampling). These worker counts were measured against the development server; they were not measured again with the build.
