# Validation gates

This package runs a validation gate: a fixed, ordered list of checks that must pass at one moment of the pull request flow. Each gate runs every step of the gate before it, then its own:

| Gate   | Command            | When it runs                                                                               | Adds                                                                                                                |
| ------ | ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Review | `pnpm gate:review` | On the branch's current commit, before an agent asks the operator to review a pull request | Static checks, build, lint, tests, Knip, brand assets, zizmor, the source-material E2E suite and the affected evals |
| Merge  | `pnpm gate:merge`  | After approval, on the head rebased onto a freshly fetched `origin/main`                   | The app E2E suite                                                                                                   |
| Deploy | `pnpm gate:deploy` | In the main checkout at exactly `origin/main`, right before a deploy                       | The mobile E2E suite, Android and then iOS                                                                          |

## What a run does

1. It checks the gate's prerequisites, all of them, before any step starts. A prerequisite that is not met fails the run and the summary names it.
   - Every gate needs Docker running, `uvx` installed and the GitHub CLI authenticated, the last two for zizmor.
   - The deploy gate also fetches `origin` and refuses unless the checkout is on `main`, `HEAD` equals `origin/main` and no tracked file has uncommitted changes. Ignored files, such as `apps/cloudflare-worker/.env.local`, do not count.
   - The deploy gate also runs the [mobile E2E suite](../../qa/mobile-e2e/README.md)'s preflight check for both platforms, so a missing Android or iOS toolchain fails the run before the web steps rather than after them.
2. It runs the gate's steps in order, each as a child process from the repository root with its output streamed to the terminal, and times each step. The first failing step stops the run, which exits non-zero.
3. Pass or fail, it prints a Markdown summary as the last output: the gate, the short commit SHA (marked when tracked files have uncommitted changes), the result and each step's duration, with skipped and not-run steps shown as such. The summary is meant to be posted verbatim as evidence; the runner never posts anything itself.

The review gate's steps are the env check, submodule check, format check, docs check and turbo boundaries; turbo build, lint and test for every package, web app component tests included; Knip; the brand-assets check; zizmor; the source-material E2E suite; and the paid narration evals (`pnpm evals`). The evals run only when `turbo ls --affected` against `main` lists `@cup/narration-source-analysis`, which happens when that library or a package it depends on changed; otherwise the summary shows them as skipped.

The merge gate adds `pnpm test:e2e:app`. The deploy gate adds `pnpm test:e2e:mobile --project android`, then `pnpm test:e2e:mobile --project ios`: the two platforms run one after the other until the parallel mobile runner has passed five consecutive warm runs.

Turbo cache hits are accepted, so no step passes `--force`. The E2E suites and the evals run outside turbo and always run fresh.

## Add a gate

Each gate's prerequisites and steps are data in [`src/gates.ts`](src/gates.ts). A later gate includes every step of the gate before it: build it by spreading its predecessor's `prerequisites` and `steps` and appending its own, then add its name to `GATE_NAMES` and a `gate:<name>` script to the root `package.json`.

## Validation

The runner has no automated tests; every gate run exercises it. After changing it, run `pnpm --filter @cup/validation-gates lint` and the gates whose steps or prerequisites changed. Run the deploy gate only in the main checkout, or show its refusals in a scratch clone whose `main` equals its `origin/main`.
