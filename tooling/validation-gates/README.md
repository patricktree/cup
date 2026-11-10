# Validation gates

This package is the runner behind `pnpm gate:review`, `pnpm gate:merge` and `pnpm gate:deploy`. The [validation section of AGENTS.md](../../AGENTS.md#validation-gates) describes the gates, their prerequisites, the pull request flow and the evidence to post; this page covers how the runner works.

## How gates compose

Each gate's prerequisites and steps are data in [`src/gates.ts`](src/gates.ts). A prerequisite is a named check that returns what is missing, if anything; a step is a named command run from the repository root without a shell, with an optional check that skips it and gives the reason. A later gate spreads its predecessor's `prerequisites` and `steps` and appends its own, so each gate includes every check of the gate before it.

## What a run does

1. It describes the commit: the short SHA, marked "with uncommitted changes" when tracked files differ from it, since the gate then ran on other code.
2. It checks every prerequisite at once, before any step starts. The deploy gate's checkout prerequisite fetches `origin` first. Any problem fails the run before its first step.
3. It runs the steps in order, each with its output streamed to the terminal, and times each one. The first failing step stops the run, which exits non-zero.
4. Pass or fail, it prints a Markdown summary as the last output: the gate, the commit, the result, why the run stopped, and each step's duration, with skipped and not-run steps shown as such. The runner never posts anything itself.

An error in the runner's own git or turbo calls, such as a missing `git` or a failing `turbo ls`, fails the run with that error named in the summary instead of crashing: while describing the commit, it stops the run before the prerequisites; while checking a prerequisite, it is that prerequisite's problem; while deciding whether to skip a step, it fails that step.

## Add a step or a gate

Add a step to the gate that first needs it in [`src/gates.ts`](src/gates.ts); later gates include it. For a new gate, define it by spreading its predecessor, add its name to `GATE_NAMES` and `GATES`, and add a `gate:<name>` script to the root `package.json`. Update the [validation section of AGENTS.md](../../AGENTS.md#validation-gates) in the same change.

## Validation

The runner has no automated tests; every gate run exercises it. After changing it, run `pnpm --filter @cup/validation-gates lint` and the gates whose steps or prerequisites changed. Run the deploy gate only in the main checkout, or show its refusals in a scratch clone whose `main` equals its `origin/main`.
