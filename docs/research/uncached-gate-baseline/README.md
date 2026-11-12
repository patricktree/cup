# Uncached deploy gate baseline

Measured on 2026-11-12 for [Where does the time of an uncached deploy gate go?](https://github.com/patricktree/cup/issues/296) of [Map: faster validation gates](https://github.com/patricktree/cup/issues/295). Throwaway research branch, never merged.

## Setup

- `pnpm gate:deploy` on `0a9452e2` in a fresh clone (its own empty Turbo cache), on an Apple M4 Max (14 cores: 10 performance, 4 efficiency; 36 GB memory, about 6 GB free at the start), Docker Desktop with 14 CPUs and 8 GB, nothing else running.
- Warm Mac otherwise: the Appium drivers were copied from the main checkout, WebDriverAgent and the emulator snapshot live in `~/Library/Caches/cup-mobile-e2e`, Gradle's cache in `~/.gradle`. The native build folders of the clone were cold.
- After the gate, each suite ran once more with a JSON reporter for per-test durations: the web app component tests and app E2E through `playwright test --reporter=json`, each mobile platform through `vitest run --project <platform> --reporter=json`. Their totals match the gate's within 5 %.
- `top` sampled CPU, load and memory every 5 s across all runs ([`load.log`](load.log)).

## Result

The uncached deploy gate passed in **21 min 11 s** ([summary](gate-summary.md)).

| Step | Duration | CPU busy, average (p90) | Notes |
| --- | --- | --- | --- |
| Static checks, build, lint, Knip, brand-assets, zizmor, source-material E2E | 47 s | 24 % (54 %) | build 20 s, lint 6 s |
| Test (`turbo:test`, 68 tasks) | 7 min 40 s | 74 % (80 %) | `@cup/web-app` component tests 457 s; every other task under 13 s, in parallel |
| App E2E | 4 min 51 s | 30 % (42 %) | 2 workers |
| Mobile E2E Android | 2 min 20 s | 53 % (65 %) | |
| Mobile E2E iOS | 5 min 38 s | 46 % (98 %) | |

## The five biggest time sinks

1. **Web app component tests, 7 min 37 s, alone on the critical path of every gate.** 1,372 test runs (343 tests × 4 browser/device projects), 1,798 s of test time on 4 workers (`maxWorkers: 4`), with the CPU 74 % busy. The two Recents and audiobook route files take 664 s and 513 s of test time. Each project costs about the same (435 to 473 s), so running a test in one project instead of four saves three quarters of its time. Per-test data: [`components-tests.csv`](components-tests.csv).
2. **Mobile iOS, 5 min 38 s.** 22 tests take 256 s of test time; the fastest (launch) takes 7.0 s, so every test pays roughly 6 to 7 s of fixed cost: the fixture removes and reinstalls the app and resets the simulator's Keychain, then starts a test Worker and a fake auth provider. Every spec file pays about 7 s more for its Appium session (file time minus test time), and about 25 s pass before the first spec (device, Appium, WebDriverAgent). The four Share Sheet and signed-in share tests take 12 to 19 s each. Per-test data: [`mobile-ios-tests.csv`](mobile-ios-tests.csv).
3. **App E2E, 4 min 51 s, on 2 workers with the CPU only 30 % busy.** 180 runs (45 tests × 4 projects), 572 s of test time. The token refresh test takes 20.5 s in every project (it sleeps out the token lifetime) and the synthesis retry test 18.5 s (it waits out the Workflow's retry backoff); together 156 s of test time. `accounts.test.ts` alone is 216 s. Per-test data: [`app-e2e-tests.csv`](app-e2e-tests.csv).
4. **The mobile platforms run one after the other.** Android's 2 min 20 s could overlap iOS; Android's own tests take 114 s of its 133 s.
5. **Every step runs one after the other.** App E2E (30 % CPU) and the mobile suite (about 50 %) leave most of the Mac idle; only the component tests come close to saturating it.

Everything else, about 1 min uncached, is not worth optimising.
