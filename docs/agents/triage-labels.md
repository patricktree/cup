# Triage labels

The engineering skills use five canonical triage roles. Each role's label carries the role's name in both trackers of the [issue tracker](issue-tracker.md).

| Canonical role    | Label             | Meaning                                  |
| ----------------- | ----------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`    | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`      | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human` | Requires human implementation            |
| `wontfix`         | `wontfix`         | Will not be actioned                     |

When a skill names a canonical role, apply its corresponding label.

`/triage` runs on the Linear backlog. Before applying a role there, check the team's labels with `list_issue_labels`, and create a missing one in team `CUP` with `save_issue_label`. A `wontfix` issue also gets the `Canceled` status.

On GitHub, `/to-spec` and `/to-tickets` apply `ready-for-agent` or `ready-for-human` to specs and tickets. Wayfinder maps and their tickets carry only `wayfinder:*` labels.
