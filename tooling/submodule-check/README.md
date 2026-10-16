# Submodule check

This CLI rejects changes that move a submodule pointer, such as `.patricktree-stack`, backwards. A lagging submodule checkout is easy to stage by accident, for example with `git add -A` while resolving rebase conflicts, and the resulting commit silently reverts a submodule update on `main`.

## Checks

A pointer moves backwards when a change records a commit that is an ancestor of the pointer it replaces or of the pointer on `origin/main`. Unchanged pointers pass, so a branch that predates a submodule update on `main` is not affected. Forward moves and moves to unrelated commits pass as well.

| Command                                                       | Runs in                               | Checks                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm submodule:check`                                        | `pnpm validate:fast`, pre-commit hook | Staged pointers against `HEAD` and `origin/main`                                                                           |
| `node tooling/submodule-check/src/cli.ts commits <revisions>` | Pre-push hook, for every pushed ref   | Each commit that is reachable from the revisions but not on a remote-tracking branch, against its parent and `origin/main` |

The pre-push check exists because `git rebase --continue` creates commits without running the pre-commit hook. When `origin/main` is unavailable, both checks compare against `HEAD` or the parent commit only and say so.

## Fix a failure

The failure message names both commits. To record the newer commit and sync the submodule checkout, run the commands from the message, for example:

```sh
git update-index --cacheinfo 160000,<newer commit>,.patricktree-stack
git submodule update -- .patricktree-stack
```

For a commit that the pre-push check rejects, amend that commit or rewrite it with `git rebase -i`. If the submodule checkout lacks one of the commits, the check cannot compare them; run `git -C .patricktree-stack fetch origin` or `git submodule update` and retry. If a downgrade is intended, bypass the hook with `--no-verify`.

## Validation

To validate this package, run `pnpm --filter @cup/submodule-check build` and `pnpm --filter @cup/submodule-check test`.
