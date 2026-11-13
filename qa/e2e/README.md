# End-to-end tests

This package tests the complete local conversion path through the web app, Worker, Durable Objects, Workflow, and R2. It prepares the narration document, then produces and validates real MP3 segments for the whole document without calling a paid AI service or a public website.

The tests run against the [test Worker](../test-worker/README.md), which supplies deterministic fakes for source-material preparation, narration selection, and speech synthesis, and a fake auth provider. The remaining application code is the production code.

## Prerequisites

- Docker with host networking support
- The repository's Node.js and pnpm versions
- `openssl` on the `PATH`, which signs the suite's local HTTPS certificate

The first test run downloads the pinned Playwright Docker image. Later runs reuse it.

## Run the tests

From the repository root, run:

```sh
pnpm run test:e2e:app
```

This command runs the suite as the cached Turbo task `turbo:e2e`, after Turbo has built the web app, the Worker and the test Worker it depends on. The tests run with at most eight parallel workers ([Runtime](#runtime)). Each test starts an isolated Wrangler process with its own port and persistence directory.

Turbo replays a passing run instead of running the suite again when nothing it hashes has changed: the package's files, the built packages it depends on, the Git-ignored `qa/test-worker/.env.local`, and a toolchain key. The uncached task `turbo:e2e:toolchain` writes that key to `.toolchain/playwright.json` before each run: the base image tag and the ID of the locally built Playwright Server image the browsers run in, so a rebuilt image misses the cache. When the image is missing, the task builds it first, so the first run on a machine writes the same key as the runs after it. When the image ID cannot be read, for example with Docker stopped, the key holds the reason, and `turbo:e2e` fails before the suite starts with a message naming the key file and the reason ([toolchain key check](../../tooling/toolchain-key/README.md#checking-a-key-file)). A replayed run keeps only its log; reports and traces exist only for runs that executed. Add `--force` to run the suite even when a pass is cached. [ADR 0024](../../docs/adr/0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md) records why.

This suite runs in the merge and deploy [validation gates](../../AGENTS.md#validation-gates). The root `pnpm test:e2e` command runs this suite followed by the live source-material extraction suite.

The [routing tests](test-e2e/routing.test.ts) exercise the built Worker's redirects and asset serving; the legacy trial redirect test uses a real browser because fragments are not sent in HTTP requests. The [navigation journey](test-e2e/navigation.test.ts) checks that Recents and a reopened track show their cached content in the production build while their refetches are held, which the web app's development-build component tests cannot show.

## Browsers and HTTPS

The suite has four Playwright projects, Chromium and WebKit each on a desktop and a mobile device, and a test's tag decides which of them run it ([ADR 0025](../../docs/adr/0025-run-only-visual-component-tests-in-all-four-browser-projects.md#extension-to-app-e2e-2026-11-13), tags in [`browser-project-tags.ts`](test-e2e/browser-project-tags.ts)):

- **Untagged tests run in desktop Chromium and mobile WebKit**, so each journey meets both engines and both viewports. These are the Worker, Workflow and account journeys: accounts, conversion, duration allowance and navigation, except the signup journey whose screenshots make it visual.
- **Tests tagged `@visual` run in all four projects.** Tag a test that asserts a screenshot, or that checks how the browser handles redirects, URL fragments, history and reloads, as the [routing tests](test-e2e/routing.test.ts) do. The suite's `expect` fails a screenshot in an untagged test.
- **Tests tagged `@request-only` run in desktop Chromium alone.** Tag a test that uses only the `request` fixture, which no browser takes part in.

The two old-origin redirect tests in [`routing.test.ts`](test-e2e/routing.test.ts) skip WebKit, because Playwright's WebKit cannot fulfill a route with a redirect status.

Each test's Worker and the fake auth provider serve HTTPS on `127.0.0.1`, as production does. The grant session cookie has the `__Secure-` prefix, and WebKit stores such a cookie only from an HTTPS response; it also blocks an HTTPS page from calling HTTP. [Global setup](test-e2e/https-certificate.global-setup.ts) signs a certificate for the run, which the [fixtures](test-e2e/fixtures.ts) pass to the test Worker and the fake auth provider; the browsers ignore certificate errors, and the tests' own requests trust it through `NODE_EXTRA_CA_CERTS`.

When a navigation replaces a page, WebKit fails that page's pending loads, which logs errors no listener sees. In WebKit, the [fixtures](test-e2e/fixtures.ts) attach the errors logged between a page's navigation request and the next page's commit to the report and leave them out of the console-error check.

## Runtime

Measured on an Apple M4 Max (14 cores, 36 GB) on 2026-11-13 with the Mac otherwise idle, as `pnpm test:e2e:app` with the workspace build cached and `turbo:e2e` missing the cache:

| Setup                                                                               | Test runs | Playwright  | `pnpm test:e2e:app` |
| ----------------------------------------------------------------------------------- | --------- | ----------- | ------------------- |
| Every test in four projects, 2 workers                                              | 180       | 4.8 min     | 290 s, 290 s, 290 s |
| Journeys in two projects, request-only tests in one, repeated states cut, 8 workers | 78        | 1.0–1.2 min | 59 s, 71 s, 73 s    |

The worker count in [`playwright.config.ts`](playwright.config.ts) is the one with the lowest wall-clock time that passed three consecutive runs without a timeout. Single Playwright runs of the new setup took 149 s at 2 workers, 105 s at 3, 83 s at 4, 62 s at 6, 55 s at 8, 57 s at 10 and 65 s at 12; at 14 workers a run took 79 s and five account tests failed on 5-second expectation timeouts. At 8 workers, six consecutive runs of `pnpm test:e2e:app` passed: 63 s, 63 s, 71 s, then the 59 s, 71 s and 73 s in the table.

No test waits for time to pass when it can wait for an event instead. The token refresh test in [`accounts.test.ts`](test-e2e/accounts.test.ts) sets the fake auth provider's access token lifetime to two seconds and waits until the token the app holds has expired, instead of sleeping six seconds three times (the [authentication page](../../docs/architecture/authentication.md) explains the lower bound). The synthesis failure test's `tts-failure` scenario fails permanently, so the segment Workflow gives up at once instead of waiting out its 15-second production retry backoff ([test Worker](../test-worker/README.md)). The two tests went from about 22 s and 20 s to about 9.5 s and 5 s each. Later the same day, three runs of `pnpm test:e2e:app` at 8 workers took 55 s, 55 s and 55 s before this change and 55 s, 56 s and 61 s after it: the summed test time fell by about 20 s, but the wall-clock time stayed where the longest journeys and the shared machine put it.

## Update screenshots

The E2E suite keeps a few screenshot assertions (the open-trial URL input screen, the signup prompt and private Recents), with desktop and mobile baselines in each browser. Detailed visual coverage, and the trial, conversion and track error and loading states, live in the [web app component tests](../../apps/web-app/README.md#component-tests-and-visual-coverage).

After an intentional visual change, run:

```sh
pnpm run test:e2e:update
```

Review every changed image under `qa/e2e/snapshots` before accepting it. Screenshot comparisons require an exact pixel match.

## Debug a test

Build the workspace, then run Playwright's debug mode directly, outside Turbo:

```sh
pnpm run build
pnpm --filter '@cup/e2e' test:e2e --debug
```

Debug mode uses the locally installed browser instead of the Docker browser. Its snapshots have a platform-specific suffix and do not replace the Docker reference images.

Playwright writes reports, traces, and failure screenshots to `qa/e2e/playwright-output`. To keep a failed test's Wrangler persistence directory for inspection, run:

```sh
E2E_RETAIN_STATE=1 pnpm run test:e2e:app --force
```

The report contains an attachment with the retained directory path.

To stream the child Wrangler logs while a test runs, add `E2E_STREAM_WRANGLER=1`.

## Cost and network boundary

The [test Worker's cost and network boundary](../test-worker/README.md#cost-and-network-boundary) applies to this suite. In addition, the Playwright fixture rejects every browser request to a host other than the test Worker and the fake auth provider.
