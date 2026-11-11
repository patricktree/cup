---
status: accepted
---

# Rerun the merge gate only after a git conflict

[ADR 0020](0020-validate-in-three-local-gates-that-trust-the-turbo-cache.md) let the agent squash-merge only if `origin/main` had not moved since the merge gate's fetch, so that `main` received exactly the tree that passed. With two approved pull requests in flight, both rebased and ran the merge gate, one merged, and the other had to rebase and rerun although the two changes were unrelated. That rerun runs the app E2E suite fresh and misses the Turbo cache after the rebase, so the operator waited minutes, merges raced each other, and every rerun cost another fetch, rebase, gate and comment cycle. The map [patricktree/cup#258](https://github.com/patricktree/cup/issues/258) decided the replacement in [#260](https://github.com/patricktree/cup/issues/260) and [#270](https://github.com/patricktree/cup/issues/270), the spec [#271](https://github.com/patricktree/cup/issues/271) described it, and [#272](https://github.com/patricktree/cup/pull/272) implemented it.

## Decision

- **Rebase once.** After approval the agent fetches `origin/main`, rebases onto it and runs the merge gate on the rebased head, as before.
- **A git conflict is the only reason to rebase again.** If `main` moves after the merge gate passes and GitHub reports no conflict, the agent squash-merges directly and lets GitHub combine the trees. The merge gate comment names the commit that passed, not the squash commit on `main`.
- **After a conflict, the full merge gate reruns.** The agent fetches, rebases, resolves the conflict and reruns the whole merge gate; no earlier pass carries over to the new head. The resolution follows the rule for fixes after approval: back to the operator if it can change behaviour, otherwise pushed and listed in the passing run's comment.
- **No check runs on `main` after merging.** Code that merges cleanly but breaks on `main` surfaces at the next gate that runs on top of it: another pull request's review or merge gate, or the deploy gate. A gate failure that also reproduces on `origin/main` gets its own fix pull request, not a fix inside the pull request that hit it.

This partially supersedes [ADR 0020](0020-validate-in-three-local-gates-that-trust-the-turbo-cache.md)'s approval decision for the moved-`main` rule only. Approval as agent discipline, the three gates, their evidence and the cache trust stand.

## Considered options

- **Keep the exact-tree rule.** Rejected: two unrelated pull requests in flight force a rebase and a rerun, and the rerun costs a fresh app E2E run plus Turbo cache misses.
- **Rerun only when the packages each side changed overlap**, found with Turbo's `[A...B]` filter ([research](../research/turbo-changed-packages-between-commits.md), [#259](https://github.com/patricktree/cup/issues/259)). Rejected: the web app changes in nearly every pull request, so overlap is the common case, and root files, `.patricktree-stack` pointer bumps and `supabase/`, which Turbo doesn't report or attributes to no package, would need special cases kept by hand.
- **A check on `main` after each merge.** Rejected: the next gate and the deploy gate catch the same breakage without another run.

## Consequences

- Code that merges cleanly but doesn't work together can land on `main`, for example a library API change on `main` against a caller in the pull request. Neither gate saw the combination.
- The next pull request's gate can fail for a reason that isn't its own, and its agent has to tell a broken `main` from a fault in its own change.
- The deploy gate stays the hard stop before production: it runs on exactly the `main` commit being deployed, so a broken `main` blocks the deploy.
