# Agent Instructions

## Documentation

Before working on the project, read the [glossary](docs/GLOSSARY.md) and the [wiki schema](docs/agents/domain.md), then the architecture pages and ADRs relevant to the task from the [documentation index](docs/README.md). Update affected documentation and diagrams in the same change as the implementation. Before changing, renaming, or removing a domain concept or cross-component behavior, find every page that describes it by the [documentation search procedure](docs/agents/documentation-search.md).

## Package Manager

- Use pnpm. Install dependencies with `pnpm install`.

## Environment setup

On a fresh checkout or worktree, initialize the shared tooling submodule before installing dependencies:

```sh
git submodule update --init --recursive
pnpm install
```

If the submodule is missing, the preinstall check initializes it and fails; retry `pnpm install`, because pnpm scanned the workspace before the submodule's packages existed. Claude Code sessions run both commands at session start through `.claude/hooks/session-start.sh`.

Cloudflare credentials are required for application development, including AI calls. The postinstall check fails until `apps/cloudflare-worker/.env.local` and `libs/narration-source-analysis/.env.evals` contain matching `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY` values. In a linked worktree, postinstall creates missing files from the main checkout's `apps/cloudflare-worker/.env.local`. In a main checkout, configure them after the initial installation attempt and retry:

```sh
node tooling/env-setup/src/cli.ts setup --from /absolute/path/to/existing.env
pnpm install
```

Use an existing credentials file or another checkout’s env file as the source. Alternatively, export `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY` and run setup without `--from`. Setup preserves existing files; both files are ignored by Git. Setup, which postinstall runs when needed, also moves an `.env.evals` left at the library's former path `libs/narration-content-selection/`. Use Node for this bootstrap step because pnpm can trigger installation before setup. `pnpm env:check` checks that both files are configured and match; postinstall and every validation gate also run it. This checks local configuration without making paid API calls.

## Validation

Git hooks run no validation, so deciding when to validate is up to you. Prefer the narrowest check that covers a change while iterating, such as one package's tests, lint, or typecheck, or `pnpm docs:check` for documentation-only edits. The only hook is pre-push, which rejects pushed commits that move a submodule pointer backwards (see the [submodule check](.patricktree-stack/tooling/submodule-check/README.md)).

### Validation gates

A validation gate is a root script that runs a fixed list of checks at one moment of the pull request flow. Each gate runs every check of the gate before it, then its own; the [validation gates runner](tooling/validation-gates/README.md) runs them:

| Gate   | Command            | When it runs                                                                         | Adds                                                                                                                                                                                                 | Evidence                                                                    |
| ------ | ------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Review | `pnpm gate:review` | On the branch's current commit, before you ask the operator to review a pull request | Static checks, build, lint, every package test including web app component tests, Knip, brand-assets check, zizmor, the source-material E2E suite, and the paid evals when their library is affected | A pull request comment from the passing run right before the review request |
| Merge  | `pnpm gate:merge`  | After approval, on the head rebased onto a freshly fetched `origin/main`             | The app E2E suite                                                                                                                                                                                    | A pull request comment from every run, pass or fail                         |
| Deploy | `pnpm gate:deploy` | In the main checkout at exactly `origin/main`, right before a deploy                 | The mobile E2E suite on Android and iOS, in parallel                                                                                                                                                 | The Linear comment that moves the issue to production QA                    |

The review gate's steps, in order: env check, submodule check (commits not yet on a remote-tracking branch, and staged pointers, against `origin/main`), format check, docs check, turbo boundaries, turbo build, turbo lint, turbo test, Knip, brand-assets check, zizmor, the source-material E2E suite, and the paid narration evals. The merge gate adds `pnpm test:e2e:app`. The deploy gate adds `pnpm test:e2e:mobile` after app E2E, which runs Android and iOS at the same time; app E2E stays before it, since running the two at once saturated the CPU and failed app E2E on timeouts (the gate runner README records the [step order](tooling/validation-gates/README.md#step-order) and the [deploy gate runtime](tooling/validation-gates/README.md#deploy-gate-runtime)). Turbo cache hits count, so no step passes `--force`. The app and source-material E2E suites are cached Turbo tasks: a gate replays a pass whose inputs, including the Playwright Server image the browsers run in, are unchanged, from any checkout or worktree on the Mac, and shows the step as `passed (replayed)` with its short duration; a replayed pass counts as evidence, and no gate forces a fresh run ([ADR 0024](docs/adr/0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md)). The mobile E2E suite is one cached Turbo task per platform, whose hash includes the native app and the Android or iOS toolchain versions ([ADR 0026](docs/adr/0026-replay-mobile-e2e-passes-per-platform-and-run-both-platforms-in-parallel.md)). The evals always run fresh.

Every gate needs Docker running, plus internet access, `uvx` and GitHub CLI authentication for zizmor. The deploy gate also needs Android Studio with Java 21 and Xcode for the [mobile E2E suite](qa/mobile-e2e/README.md#prerequisites), and refuses to run unless the checkout is on `main`, `HEAD` equals a freshly fetched `origin/main`, and no tracked file has changes; ignored files such as `.env.local` do not count. A gate checks all its prerequisites before its first step, including the mobile suite's preflight check in the deploy gate, so a missing toolchain fails it before the web steps. A gate stops at its first failing step and, pass or fail, prints a Markdown summary (gate, short commit SHA, result, each step's duration, and why it stopped); post that summary verbatim as the evidence. When a failure also reproduces on `origin/main`, `main` is broken: fix it in its own pull request, not in the pull request that hit it. The review gate runs the evals only when `turbo ls --affected` lists `@cup/narration-source-analysis`, that is when the library or a package it depends on changed relative to the last fetched `origin/main`, so it can make paid AI calls; `pnpm evals` runs them explicitly, and nothing else does.

### Pull request flow

The flow is agent discipline: only squash merges are allowed, `main` has no branch protection, and pull requests are opened as `patricktree`, so GitHub cannot record the operator's approval.

1. **Review.** Run the review gate on the branch's current commit, post its summary as a pull request comment, and ask the operator for review. During review, rebase onto `main` only to resolve conflicts.
2. **Approval.** Approval is the operator's go-ahead in your agent session or an approving pull request comment from `patricktree`, and nothing else.
3. **Merge.** Fetch `origin/main`, rebase onto it, and run the merge gate on the rebased head. If `main` moves after the gate passes, squash-merge anyway as long as GitHub reports no conflict; on a conflict, fetch, rebase, resolve it, and rerun the merge gate. Post every merge gate run's summary as a pull request comment.
4. **Fixes after approval.** A fix that can change behaviour goes back to the operator with a pull request comment saying what changed and why. Push behaviour-preserving fixes (formatting, lint autofixes, regenerated files, refreshed screenshot baselines for a rendering-only difference) without another review, and list them in the passing merge gate run's comment.
5. **Deploy.** Merging deploys nothing; the deploy is the manual step in the [production configuration guide](docs/production-configuration.md#deploy). Run the deploy gate in the main checkout on exactly the `main` commit being deployed, and deploy that commit. A failure blocks the deploy, and its fix goes through a new pull request and this whole flow. Post the deploy gate's summary in the Linear comment that moves the issue to production QA ([issue tracker](docs/agents/issue-tracker.md#from-backlog-to-map-or-spec)).

### Test suites

Test suites can run concurrently in several checkouts. Each run starts its own servers on ports the operating system assigns and never attaches to a server that is already running, so keep fixed ports and `reuseExistingServer` out of test configuration. The one exception is the Playwright Server container from the shared Playwright configuration: all runs of one Playwright version share it, and it stops itself when idle (see the [shared configuration](.patricktree-stack/tooling/config-playwright/README.md#shared-playwright-server-container)).

Tests are never retried: leave Vitest `retry` and Playwright `retries` at their default of 0 in configs and individual tests (an explicit 0 is fine), and fix a flaky test instead of retrying it.

Tests that exercise Resend use the [Resend stub](qa/resend-stub/README.md). Its live contract test, `pnpm test:resend-live`, sends real email, so only the operator runs it.

Use `pnpm test:e2e:app` or `pnpm test:e2e:source-material` to rerun a single E2E suite; each builds what the suite needs through Turbo and replays a cached pass, and `--force` runs it fresh. `pnpm test:e2e` runs both. `pnpm test:e2e:mobile` runs the mobile suite the same way, Android and iOS in parallel as two cached tasks; `pnpm test:e2e:mobile:android` and `pnpm test:e2e:mobile:ios` run one platform. `pnpm test:e2e:mobile:clean` removes emulators and simulators that killed mobile runs left behind; each run also does that first. Builds use checked-in brand assets; after changing their sources, run `pnpm brand-assets:sync` and review the generated changes. `pnpm brand-assets:check` reports stale files without modifying them. `pnpm screenshots:update` refreshes the web app component screenshot baselines and the app E2E baselines and runs no other check; afterwards, run the gate you are at.

When you commit a new kind of generated file, mark its path `linguist-generated=true` in `.gitattributes`. GitHub then collapses it in pull request diffs, and agent code reviews leave it out of the diff they read (`git diff -- . ':(exclude,attr:linguist-generated=true)'`).

Worker types (`worker-configuration.d.ts`) are generated, not committed: postinstall and the `turbo:cf-typegen` task, which build, lint, and test wait for, write them from each Wrangler config. If your editor reports missing Worker types, run `pnpm cf-typegen`.

## Repository References

| Need                                                                                                 | File                                                           |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Issue trackers: Linear for the backlog, GitHub Issues for specifications, tickets and wayfinder maps | [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) |
| Triage labels                                                                                        | [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md) |
| Documentation wiki schema                                                                            | [`docs/agents/domain.md`](docs/agents/domain.md)               |

## Package instructions

Before editing a package, read its `AGENTS.md` when it has one, such as [`libs/conversion-grants/AGENTS.md`](libs/conversion-grants/AGENTS.md) for that library's source folders and import directions.
