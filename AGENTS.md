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

Git hooks run no validation, so deciding when to validate is up to you. Prefer the narrowest check that covers a change while iterating, such as one package's tests, lint, or typecheck, or `pnpm docs:check` for documentation-only edits. Run `pnpm validate:fast` before committing a change that touches code, configuration, or dependencies. Shipping to production means pushing to `main`, the default branch; run `pnpm validate` on the changes being shipped before that push. The only hook is pre-push, which rejects pushed commits that move a submodule pointer backwards (see the [submodule check](.patricktree-stack/tooling/submodule-check/README.md)).

The root `package.json` defines each group. `pnpm validate:fast` covers static checks, build, lint, and tests including browser component tests; `pnpm validate:extended` covers the brand-assets check, online zizmor, and both E2E suites; `pnpm validate` runs fast, then extended. `pnpm validate:update-snapshots` runs both while updating the component and app E2E screenshot baselines. `pnpm validate:evals` runs the paid narration-content-selection evals; invoke it only explicitly.

The groups are independent and stop on failure; extended does not run the fast group. Both free groups require Docker; extended also needs internet access, `uvx`, and GitHub CLI authentication for zizmor. Fast validation requires the configured environment files but invokes no paid AI service. Declutter runs after the build because Knip loads the Worker's Vite config, which requires the built web app.

Test suites can run concurrently in several checkouts. Each run starts its own servers on ports the operating system assigns and never attaches to a server that is already running, so keep fixed ports and `reuseExistingServer` out of test configuration.

Tests are never retried: leave Vitest `retry` and Playwright `retries` at their default of 0 in configs and individual tests (an explicit 0 is fine), and fix a flaky test instead of retrying it.

Tests that exercise Resend use the [Resend stub](qa/resend-stub/README.md). Its live contract test, `pnpm test:resend-live`, sends real email, so only the operator runs it.

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
