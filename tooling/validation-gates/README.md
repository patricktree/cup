# Validation gates

This package is the runner behind `pnpm gate:review`, `pnpm gate:merge` and `pnpm gate:deploy`. The [validation section of AGENTS.md](../../AGENTS.md#validation-gates) describes the gates, their prerequisites, the pull request flow and the evidence to post; this page covers how the runner works.

## How gates compose

Each gate's prerequisites and steps are data in [`src/gates.ts`](src/gates.ts). A prerequisite is a named check that returns what is missing, if anything; a step is a named command run from the repository root without a shell, with an optional check that skips it and gives the reason. A later gate spreads its predecessor's `prerequisites` and `steps` and appends its own, so each gate includes every check of the gate before it.

## Step order

| Gate   | Steps, in order                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Review | Env check, submodule check, format check, docs check, Turbo boundaries, Build, Lint, Test, Knip, brand-assets check, zizmor, source-material E2E, narration evals (skipped unless their library is affected) |
| Merge  | The review gate's steps, then app E2E                                                                                                                                                                        |
| Deploy | The merge gate's steps, then mobile E2E, one step that runs Android and iOS at the same time                                                                                                                 |

App E2E runs before mobile E2E, not alongside it. Running the two at the same time was tried on 2026-11-13 ([#311](https://github.com/patricktree/cup/issues/311)) with the runner starting both steps at once, and rejected: it was neither stable nor faster. In two uncached deploy gates the CPU was 97 % and 99 % busy while both ran, against 68 % for mobile E2E alone; app E2E's 8 workers took 2 min 30 s and 2 min 20 s instead of 55 s and failed on timeouts (1 and 5 tests, all in `accounts.test.ts`), and mobile E2E took 5 min 18 s and 5 min 9 s instead of 4 min 9 s, Android 222 to 234 s instead of 165 s and iOS 305 to 314 s instead of 244 s. So the two steps together took longer than in sequence, 5 min 4 s. Fewer app E2E workers would leave the CPU room, but app E2E alone then takes 83 s at 4 workers to 149 s at 2 ([its runtime](../../qa/e2e/README.md#runtime)), against at most 55 s to save.

## Deploy gate runtime

Measured on 2026-11-13 ([#311](https://github.com/patricktree/cup/issues/311)) on the Apple M4 Max (14 cores) with nothing else running, against the [baseline](https://github.com/patricktree/cup/issues/296) of 2026-11-12 on `0a9452e2`, before the [faster gates spec](https://github.com/patricktree/cup/issues/303). Uncached is a fresh clone with an empty Turbo cache; cached is the same commit run again in that clone. The cached baseline, 13 min 29 s, reran every E2E suite.

| Step                                                                                      | Uncached baseline | Uncached now   | Cached now |
| ----------------------------------------------------------------------------------------- | ----------------- | -------------- | ---------- |
| Env, submodule, format and docs checks, Turbo boundaries                                  | 5.4 s             | 3.4 s          | 3.0 s      |
| Build                                                                                     | 20.2 s            | 10.1 s         | 0.1 s      |
| Lint                                                                                      | 6.3 s             | 5.1 s          | 0.1 s      |
| Test                                                                                      | 7 min 40 s        | 2 min 22 s     | 0.6 s      |
| Knip, brand-assets check, zizmor                                                          | 5.1 s             | 4.2 s          | 3.2 s      |
| Source-material E2E                                                                       | 4.2 s             | 4.4 s          | 0.3 s      |
| App E2E                                                                                   | 4 min 51 s        | 54.5 s         | 0.7 s      |
| Mobile E2E (baseline: Android 2 min 20 s, then iOS 5 min 38 s; now both at the same time) | 7 min 58 s        | 4 min 5 s      | 0.3 s      |
| **Total**                                                                                 | **21 min 11 s**   | **7 min 50 s** | **9.9 s**  |

The narration evals were skipped in every run, since their library was not affected. A cached run replays every Turbo task, the E2E suites included, so its remaining seconds are the checks outside Turbo.

## What a run does

1. It describes the commit: the short SHA, marked "with uncommitted changes" when tracked files differ from it, since the gate then ran on other code.
2. It checks every prerequisite at once, before any step starts. The deploy gate's checkout prerequisite fetches `origin` first. Any problem fails the run before its first step.
3. It runs the steps in order, each with its output streamed to the terminal, and times each one. The first failing step stops the run, which exits non-zero. A step that runs a cached Turbo task passes when Turbo replays the task. For the E2E suites ([ADR 0024](../../docs/adr/0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md), [ADR 0026](../../docs/adr/0026-replay-mobile-e2e-passes-per-platform-and-run-both-platforms-in-parallel.md)), the runner also keeps a copy of the step's streamed output, and when Turbo reports every E2E suite task in it as a `cache hit` (the uncached toolchain-key task and the builds it depends on do not count), the summary's Result reads `passed (replayed)` ([#302](https://github.com/patricktree/cup/issues/302)). A replayed pass counts as the step's evidence, including the deploy gate's mobile step in the Linear comment that moves an issue to production QA; the summary does not name the run it replays, since Turbo's local cache does not record it, and no gate forces a fresh run. Nor does it run steps at the same time: the deploy gate's single mobile step runs the Android and iOS tasks through one `turbo run`, which runs them in parallel and, when one fails, still lets the other finish, so the step's duration is the slower platform's.
4. Pass or fail, it prints a Markdown summary as the last output: the gate, the commit, the result, why the run stopped, and each step's duration, with skipped and not-run steps shown as such. The runner never posts anything itself.

An error in the runner's own git or turbo calls, such as a missing `git` or a failing `turbo ls`, fails the run with that error named in the summary instead of crashing: while describing the commit, it stops the run before the prerequisites; while checking a prerequisite, it is that prerequisite's problem; while deciding whether to skip a step, it fails that step.

## Add a step or a gate

Add a step to the gate that first needs it in [`src/gates.ts`](src/gates.ts); later gates include it. For a new gate, define it by spreading its predecessor, add its name to `GATE_NAMES` and `GATES`, and add a `gate:<name>` script to the root `package.json`. Update the [validation section of AGENTS.md](../../AGENTS.md#validation-gates) in the same change.

## Validation

The runner has no automated tests; every gate run exercises it. After changing it, run `pnpm --filter @cup/validation-gates lint` and the gates whose steps or prerequisites changed. Run the deploy gate only in the main checkout, or show its refusals in a scratch clone whose `main` equals its `origin/main`.
