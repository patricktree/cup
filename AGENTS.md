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

Cloudflare credentials are required for application development, including AI calls. The postinstall check fails until `apps/cloudflare-worker/.env.local` and `libs/narration-content-selection/.env.evals` contain matching `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY` values. In a linked worktree, postinstall creates missing files from the main checkout's `apps/cloudflare-worker/.env.local`. In a main checkout, configure them after the initial installation attempt and retry:

```sh
node tooling/env-setup/src/cli.ts setup --from /absolute/path/to/existing.env
pnpm install
```

Use an existing credentials file or another checkout’s env file as the source. Alternatively, export `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY` and run setup without `--from`. Setup preserves existing files; both files are ignored by Git. Use Node for this bootstrap step because pnpm can trigger installation before setup. `pnpm env:check` checks that both files are configured and match; postinstall and fast validation also run it. This checks local configuration without making paid API calls.

## Validation

Run `pnpm validate:fast` as needed during development. Shipping to production means pushing to `main`, the default branch. Run `pnpm validate` to complete both fast and extended checks on the changes being shipped. The pre-commit hook runs only the fast group. The pre-push hook rejects pushed commits that move a submodule pointer backwards (see the [submodule check](.patricktree-stack/tooling/submodule-check/README.md)) and runs extended validation when a push updates `main`.

| Command                          | Scope                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:fast`             | Environment check, submodule pointer check, format check, Markdown/local-link/Mermaid checks, Turborepo Boundaries, build/typecheck, lint, existing tests including browser component tests, and declutter (Knip) |
| `pnpm validate:extended`         | Brand-assets check, authenticated online zizmor, and both E2E suites                                                                                                                                              |
| `pnpm validate`                  | Fast, then extended                                                                                                                                                                                               |
| `pnpm validate:update-snapshots` | Full validation with component and app E2E screenshot baseline updates                                                                                                                                            |
| `pnpm validate:evals`            | Paid narration-content-selection evals; invoke explicitly                                                                                                                                                         |

The groups are independent and stop on failure. Extended does not run the fast group. Both free groups require Docker; extended also needs internet access, `uvx`, and GitHub CLI authentication for zizmor. Source-material E2E tests replay locally hosted page fixtures, including the scripts and content API responses needed for JavaScript rendering; see `libs/prepare-source-material/test-e2e/fixtures/README.md`. Fast validation requires the configured environment files but does not invoke paid AI services. Declutter runs after the build because Knip loads the Worker's Vite config, which requires the built web app.

Test suites can run concurrently in several checkouts. Each run starts its own servers on ports the operating system assigns and never attaches to a server that is already running, so keep fixed ports and `reuseExistingServer` out of test configuration.

Tests are never retried: leave Vitest `retry` and Playwright `retries` at their default of 0 in configs and individual tests (an explicit 0 is fine), and fix a flaky test instead of retrying it.

Tests that exercise Resend use the Resend stub (`@cup/resend-stub` in `qa/resend-stub`): a local stand-in for `POST /emails` that models Resend’s request checks and idempotency and lets a test script, hang, or hold the next answer. `pnpm test:resend-live` (in `qa/resend-stub/test-live/`, with its own Vitest config) is the opt-in contract test that checks the stub’s model against the real Resend API. It needs `RESEND_API_KEY` (`RESEND_FROM` defaults to `Cup <no-reply@cup.audio>`) and sends real emails to `delivered@resend.dev`, so it is part of no validation command and only the operator runs it; agents never run it.

Use `pnpm test:e2e:app` or `pnpm test:e2e:source-material` to rerun a single E2E suite. `pnpm test:e2e` runs both. Builds use checked-in brand assets; after changing their sources, run `pnpm brand-assets:sync` and review the generated changes. `pnpm brand-assets:check` reports stale files without modifying them.

When you commit a new kind of generated file, mark its path `linguist-generated=true` in `.gitattributes`. GitHub then collapses it in pull request diffs, and agent code reviews leave it out of the diff they read (`git diff -- . ':(exclude,attr:linguist-generated=true)'`).

Worker types (`worker-configuration.d.ts`) are generated, not committed: postinstall and the `turbo:cf-typegen` task, which build, lint, and test wait for, write them from each Wrangler config. If your editor reports missing Worker types, run `pnpm cf-typegen`.

## Repository References

| Need                                                              | File                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Issue tracker (GitHub Issues), specifications, and wayfinder maps | [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) |
| Triage labels                                                     | [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md) |
| Documentation wiki schema                                         | [`docs/agents/domain.md`](docs/agents/domain.md)               |

## Package instructions

Before editing a package, read its `AGENTS.md` when it has one, such as [`libs/conversion-grants/AGENTS.md`](libs/conversion-grants/AGENTS.md) for that library's source folders and import directions.
