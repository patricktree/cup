# Validation gates

This package runs a validation gate: a fixed, ordered list of checks that must pass at one moment of the pull request flow. The review gate runs on the branch's current commit before an agent asks the operator to review a pull request:

```sh
pnpm gate:review
```

## What a run does

1. It checks the gate's prerequisites that are cheap to check: Docker running, `uvx` installed and the GitHub CLI authenticated, the last two for zizmor. A missing prerequisite fails the run before any step starts and names what is missing.
2. It runs the gate's steps in order, each as a child process from the repository root with its output streamed to the terminal, and times each step. The first failing step stops the run, which exits non-zero.
3. Pass or fail, it prints a Markdown summary as the last output: the gate, the short commit SHA (marked when tracked files have uncommitted changes), the result and each step's duration, with skipped and not-run steps shown as such. The summary is meant to be posted verbatim as a pull request comment; the runner never posts anything itself.

The review gate's steps are the env check, submodule check, format check, docs check and turbo boundaries; turbo build, lint and test for every package, web app component tests included; Knip; the brand-assets check; zizmor; the source-material E2E suite; and the paid narration evals (`pnpm evals`). The evals run only when `turbo ls --affected` against `main` lists `@cup/narration-source-analysis`, which happens when that library or a package it depends on changed; otherwise the summary shows them as skipped.

Turbo cache hits are accepted, so no step passes `--force`. The E2E suite and the evals run outside turbo and always run fresh.

## Add a gate

Each gate's prerequisites and steps are data in [`src/gates.ts`](src/gates.ts). A later gate includes every step of the gate before it: build it by spreading its predecessor's `prerequisites` and `steps` and appending its own, then add its name to `GATE_NAMES` and a `gate:<name>` script to the root `package.json`.

## Validation

The runner has no automated tests; every gate run exercises it. After changing it, run `pnpm --filter @cup/validation-gates lint` and `pnpm gate:review`.
