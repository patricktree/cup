# Issue tracker: Linear and GitHub Issues

Cup tracks work in two places, split by what an issue is:

| Tracker                                                                         | Holds                                                                                                     | Access                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| Linear: team `CUP` in the [`cup-audio`](https://linear.app/cup-audio) workspace | The backlog: feature requests, improvements and bugs, until one is picked up as a wayfinder map or a spec | The Linear MCP server |
| GitHub Issues in [`patricktree/cup`](https://github.com/patricktree/cup/issues) | Wayfinder maps and their decision tickets, specs, and implementation tickets                              | The `gh` CLI          |

Local `.scratch/` maps are for throwaway work only; anything a later ADR or landing needs to cite goes on GitHub.

## Which tracker

- **GitHub**: everything `/wayfinder`, `/to-spec`, `/to-tickets` and `/implement-spec` create, read or close.
- **Linear**: everything else, including `/triage`, a new feature request, improvement or bug, a follow-up noticed in passing, and the findings of the [wiki health review](domain.md#review-the-wikis-health).

## Linear

Fetch the team's labels, projects, statuses and members when you need them (`list_issue_labels`, `list_projects` and `list_issue_statuses` with team `CUP`; `list_users`); they change, so this file names none of them. Choose from what exists, and ask before creating a label or project, except the triage labels in [triage-labels.md](triage-labels.md).

- **Create an issue**: `save_issue` with team `CUP`, a title and a Markdown description. Add the type label that fits, and a project when one fits; new issues start in the team's backlog status.
- **Read an issue**: `get_issue` with its identifier (`CUP-<n>`), plus `list_comments` for its comments.
- **List issues**: `list_issues` with team `CUP` and `state`, `label` or `project` filters.
- **Comment**: `save_comment` with `issueId`.
- **Apply / remove labels**: `save_issue` with `addLabels` / `removeLabels`.
- **Relate or block**: `save_issue` with `relatedTo`, `blockedBy` or `blocks`.
- **Link a GitHub issue**: `save_issue` with `links: [{url, title}]`.
- **Close**: comment the reason, then `save_issue` with `state` set to the team's completed status, or its canceled status when the issue won't be done.

## GitHub

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Create a `wayfinder:*` or [triage](triage-labels.md) label with `gh label create` when the repo lacks it. Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## From backlog to map or spec

When a Linear issue is picked up as a wayfinder map or a spec:

1. The GitHub issue's context names the Linear issue and links it.
2. The Linear issue gets a link to the GitHub issue and moves to the team's started status.
3. When the spec's build is merged, or the map closes without a build, close the Linear issue as completed, with a comment that links the outcome.

## When a skill says "publish to the issue tracker"

Pick the tracker by **Which tracker** above.

## When a skill says "fetch the relevant ticket"

`CUP-<n>` or a `linear.app` URL is a Linear issue: read it as in **Linear**. `#<n>` or a `github.com` URL is a GitHub issue or PR: read it as in **GitHub**. The numbers overlap, so never resolve a bare number without its prefix.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
- **Land**: once the effort's build is merged, land it into the wiki as described in [the wiki schema](domain.md#land-a-finished-effort).
