---
status: partially superseded by ADR 0021, ADR 0024 and ADR 0026
---

# Validate in three local gates that trust the Turbo cache

[ADR 0021](0021-rerun-the-merge-gate-only-after-a-git-conflict.md) supersedes this decision for the moved-`main` rule only: when `main` moves after the merge gate passes, the agent squash-merges anyway as long as GitHub reports no conflict, and only a conflict sends the pull request through another rebase and merge gate run. [ADR 0024](0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md) supersedes it for the app and source-material E2E suites, which now run as cached Turbo tasks with a toolchain key instead of always running fresh. [ADR 0026](0026-replay-mobile-e2e-passes-per-platform-and-run-both-platforms-in-parallel.md) supersedes it for the mobile E2E suite, which now runs each platform as a cached Turbo task, and for the sequential mobile platforms: the deploy gate runs Android and iOS in parallel. Everything else below remains accepted, and the original decisions are preserved as historical rationale.

Cup has no CI: every check runs on the developer's Mac, and the mobile E2E suite needs Xcode and Android Studio there ([ADR 0018](0018-test-the-mobile-apps-with-appium-through-webdriverio-on-host-owned-emulators-and-simulators.md)). Until 2026-11-10 the checks came in `pnpm validate:fast`, `pnpm validate` and `pnpm validate:extended`, groups that matched no moment of the pull request flow agents follow: an agent asking for review ran either too little or about 8 minutes of mobile E2E on top, nothing said what reruns after approval, and nothing tied a deploy to a tested commit. The map [patricktree/cup#232](https://github.com/patricktree/cup/issues/232) decided the replacement in [#233](https://github.com/patricktree/cup/issues/233), [#234](https://github.com/patricktree/cup/issues/234) and [#235](https://github.com/patricktree/cup/issues/235), the spec [#243](https://github.com/patricktree/cup/issues/243) described it, and [#255](https://github.com/patricktree/cup/pull/255) built it.

## Decision

- **Three validation gates, each tied to one moment of the pull request flow.** The review gate runs before the agent asks for review, the merge gate after approval on the head rebased onto a freshly fetched `origin/main`, the deploy gate in the main checkout at exactly `origin/main` right before a manual deploy. Each runs every check of the gate before it. [AGENTS.md](../../AGENTS.md#validation-gates) lists the steps and the flow; the [gate runner](../../tooling/validation-gates/README.md) holds them as data.
- **Every gate accepts Turbo cache hits; none passes `--force`.** The uncached review gate takes about 8 minutes, nearly all of it the web app component tests, and with cache seconds. This rests on a review of every task's cache inputs ([research](../research/gate-cache-and-mobile-parallelism.md)) and on fixing what it found ([`917158c6`](https://github.com/patricktree/cup/commit/917158c6)). The E2E suites and the evals run outside Turbo and always run fresh.
- **The paid evals run only in the review gate, and only when `@cup/narration-source-analysis` or a package it depends on is affected.** A prompt regression must surface while the change is under review; in the deploy gate, varying model output under the no-retry rule would block deploys by chance.
- **Approval is agent discipline, not branch protection.** Pull requests are opened as `patricktree`, so GitHub cannot record the operator's approving review. Approval is the operator's go-ahead in the agent session or an approving comment from `patricktree`; the agent squash-merges only if `origin/main` has not moved since the merge gate's fetch, so `main` receives exactly the tree that passed. [ADR 0021](0021-rerun-the-merge-gate-only-after-a-git-conflict.md) replaced the moved-`main` rule.
- **Each gate run leaves its printed summary as evidence**: a pull request comment for the review gate (the passing run before the review request) and the merge gate (every run), the Linear comment moving the issue to `Ready4QA` for the deploy gate.
- **The deploy gate runs the mobile platforms one after the other** until five consecutive warm parallel runs pass with no retries, although `pnpm test:e2e:mobile` already runs them in parallel. Under load a timeout fails the gate, since tests are never retried, so the faster runner earns its place before it can block a deploy.

## Considered options

- **Force uncached runs in some or all gates.** Rejected: an uncached review gate costs 7 minutes for every review request and after every rebase. The research names `--force` before a deploy as a backstop if a later cache gap turns up, because a static review cannot rule out a read it did not search for.
- **Web app component tests in the merge gate.** Rejected: they are the review gate's critical path, but a failure discovered after approval would send a behaviour change back to review anyway.
- **Evals in the deploy gate, always or when narration code changed since the last deploy.** Rejected for the reason above.
- **CI.** Out of scope: the mobile suite needs the Mac's toolchains, and the flow had to work without it.

## Consequences

- A merge gate failure that needs a behaviour change goes back to the operator; behaviour-preserving fixes are pushed and listed in the passing run's comment. A deploy gate failure blocks the deploy, and its fix takes a new pull request through the whole flow, with no hotfix exception.
- A task that reads a file outside its cache inputs can replay a stale pass in every gate. New tests that read across packages must add the file to their task's `inputs` or turn caching off, as `@cup/workspace-checks` does.
- Open: what a Play Store or App Store release adds to the deploy gate, and whether the operator or an agent runs the deploy gate and the deploy. Both wait for store publishing.
