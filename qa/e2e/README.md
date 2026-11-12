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

This command runs the suite as the cached Turbo task `turbo:e2e`, after Turbo has built the web app, the Worker and the test Worker it depends on. The tests run with at most two parallel workers. Each test starts an isolated Wrangler process with its own port and persistence directory.

Turbo replays a passing run instead of running the suite again when nothing it hashes has changed: the package's files, the built packages it depends on, the Git-ignored `qa/test-worker/.env.local`, and a toolchain key. The uncached task `turbo:e2e:toolchain` writes that key to `.toolchain/playwright.json` before each run: the base image tag and the ID of the locally built Playwright Server image the browsers run in, so a rebuilt image misses the cache. When the image ID cannot be read, for example before the first run builds the image, the key holds a random value and the suite runs. A replayed run keeps only its log; reports and traces exist only for runs that executed. Add `--force` to run the suite even when a pass is cached. [ADR 0024](../../docs/adr/0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md) records why.

This suite runs in the merge and deploy [validation gates](../../AGENTS.md#validation-gates). The root `pnpm test:e2e` command runs this suite followed by the live source-material extraction suite.

The [routing tests](test-e2e/routing.test.ts) exercise the built Worker's redirects and asset serving; the legacy trial redirect test uses a real browser because fragments are not sent in HTTP requests. The [navigation journey](test-e2e/navigation.test.ts) checks that Recents and a reopened track show their cached content in the production build while their refetches are held, which the web app's development-build component tests cannot show.

## Browsers and HTTPS

Every test runs in Chromium and WebKit, each on a desktop and a mobile device. The two old-origin redirect tests in [`routing.test.ts`](test-e2e/routing.test.ts) run in Chromium only, because Playwright's WebKit cannot fulfill a route with a redirect status.

Each test's Worker and the fake auth provider serve HTTPS on `127.0.0.1`, as production does. The grant session cookie has the `__Secure-` prefix, and WebKit stores such a cookie only from an HTTPS response; it also blocks an HTTPS page from calling HTTP. [Global setup](test-e2e/https-certificate.global-setup.ts) signs a certificate for the run, which the [fixtures](test-e2e/fixtures.ts) pass to the test Worker and the fake auth provider; the browsers ignore certificate errors, and the tests' own requests trust it through `NODE_EXTRA_CA_CERTS`.

When a navigation replaces a page, WebKit fails that page's pending loads, which logs errors no listener sees. In WebKit, the [fixtures](test-e2e/fixtures.ts) attach the errors logged between a page's navigation request and the next page's commit to the report and leave them out of the console-error check.

## Update screenshots

The E2E suite keeps a few screenshot assertions (the open-trial URL input screen, the signup prompt and private Recents), with desktop and mobile baselines in each browser. Detailed visual coverage lives in the [web app component tests](../../apps/web-app/README.md#component-tests-and-visual-coverage); the E2E tests retain their behavior assertions.

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
