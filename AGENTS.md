# Agent Instructions

## Documentation

Before working on the project, read [the glossary](docs/GLOSSARY.md) and [documentation maintenance instructions](docs/agents/domain.md), then consult relevant architecture pages and ADRs from [the documentation index](docs/README.md). Update affected documentation and diagrams in the same change as the implementation.

Before changing, renaming, or removing a domain concept or cross-component behavior, run `pnpm docs:search query "question" --json` and review relevant results, even when the exact phrase or affected page is already known. Follow the [documentation search procedure](docs/agents/domain.md#find-supporting-documentation) to find related descriptions and verify removals.

## Package Manager

- Use pnpm. Install dependencies with `pnpm install`.

## Environment setup

On a fresh checkout or worktree, initialize the shared tooling submodule before installing dependencies. The preinstall check rejects a missing or empty `.patricktree-stack` directory:

```sh
git submodule update --init --recursive
pnpm install
```

Cloudflare credentials are required for application development, including AI calls. The postinstall check fails until `apps/cloudflare-worker/.env.local` and `libs/narration-content-selection/.env.evals` contain matching `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY` values. After the initial installation attempt, configure them and retry:

```sh
node tooling/env-setup/src/cli.ts setup --from /absolute/path/to/existing.env
pnpm install
```

Use an existing credentials file or another checkout’s env file as the source. Alternatively, export `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY` and run setup without `--from`. Setup preserves existing files; both files are ignored by Git. Use Node for this bootstrap step because pnpm can trigger installation before setup. `pnpm env:check` checks that both files are configured and match; postinstall and fast validation also run it. This checks local configuration without making paid API calls.

## Validation

Run `pnpm validate:fast` as needed during development. Shipping to production means pushing to `main`, the default branch. Run `pnpm validate` to complete both fast and extended checks on the changes being shipped. The pre-commit hook runs only the fast group; the pre-push hook runs extended validation when a push updates `main`.

| Command                  | Scope                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm validate:fast`     | Environment check, format check, Markdown/local-link checks, build/typecheck, lint, and existing tests including browser component tests |
| `pnpm validate:extended` | Declutter, brand-assets check, authenticated online zizmor, and both E2E suites                                                          |
| `pnpm validate`          | Fast, then extended                                                                                                                      |
| `pnpm validate:evals`    | Paid narration-content-selection evals; invoke explicitly                                                                                |

The groups are independent and stop on failure. Extended does not run the fast group. Both free groups require Docker; extended also needs internet access, `uvx`, and GitHub CLI authentication for zizmor. Source-material E2E tests replay locally hosted page fixtures, including the scripts and content API responses needed for JavaScript rendering; see `libs/prepare-source-material/test-e2e/fixtures/README.md`. Fast validation requires the configured environment files but does not invoke paid AI services.

Use `pnpm test:e2e:app` or `pnpm test:e2e:source-material` to rerun a single E2E suite. `pnpm test:e2e` runs both. Builds use checked-in brand assets; after changing their sources, run `pnpm brand-assets:sync` and review the generated changes. `pnpm brand-assets:check` reports stale files without modifying them.

## Repository References

| Need                                | File                           |
| ----------------------------------- | ------------------------------ |
| Issue tracker and specifications    | `docs/agents/issue-tracker.md` |
| Triage labels                       | `docs/agents/triage-labels.md` |
| Domain terminology and ADR guidance | `docs/agents/domain.md`        |
