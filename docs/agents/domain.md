# Documentation wiki

Cup keeps an LLM-maintained wiki in `docs/`: agents write and maintain the pages, humans read and steer them. This file is the wiki's schema. Cup has one domain context; engineering skills reach the wiki as the repository's domain docs, with the glossary at [`docs/GLOSSARY.md`](../GLOSSARY.md) and decisions in [`docs/adr/`](../adr/README.md).

## Layers

| Layer         | Pages                                                                                           | Written as                                           |
| ------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Vocabulary    | [`GLOSSARY.md`](../GLOSSARY.md)                                                                 | Definitions: what each term means                    |
| Current state | [`architecture/`](../architecture/README.md) and the guides listed in the [index](../README.md) | The present: what the checkout does now              |
| Decisions     | [`adr/`](../adr/README.md)                                                                      | History: what was decided, when, where and why       |
| Evidence      | [`research/`](../research/README.md)                                                            | History: what was found, when and from which sources |

The code is the source of truth for behaviour. Current-state pages are the only layer that needs upkeep, so keep it small: cover only what no single file shows (how components relate, invariants, flows across components, data ownership) and link to the code for the rest. A section past about 300 words or a page past about 1,500 is a compaction signal. When a rule can be enforced by a lint rule, an import boundary, a contract snapshot or a test, enforce it there and let the page name the check instead of restating the rule; prose keeps the rationale and the flows no check expresses.

Decision and evidence pages are history, which cannot go stale: each claim carries its date and its source (issue, PR, commit or URL), claims about code cite a commit, and a changed conclusion gets a new dated note or a superseding ADR, never a rewrite.

The [index](../README.md) lists every page, directly or through the `README.md` of its directory, with a one-line summary. Git history is the wiki's log: each wiki change rides in the commit of the change it describes, and there is no log file.

## Before design or implementation

Read the [glossary](../GLOSSARY.md), then the [index](../README.md), then the architecture pages and ADRs that touch the area. Surface required documents that are missing. Use the glossary's terms in issues, specs, tests and code, in place of the synonyms it lists under _Avoid_. The glossary is the sole vocabulary authority: a concept it lacks is either invented language (reconsider it) or a real gap (resolve its meaning and necessity with the `domain-modeling` skill before using it).

For Cloudflare runtime, configuration and design decisions, follow the [Cloudflare documentation guidance](cloudflare.md).

When your change contradicts an accepted ADR, say so before going ahead.

## Update with the implementation

Update affected pages and diagrams in the same change as the code whenever it moves a component boundary, an authentication or authorization flow, data ownership, a storage lifecycle, an external dependency or a cross-component behaviour. A change confined to one module needs no wiki change. Verify retained claims against the linked code.

Document responsibilities, relationships, invariants and flows that span components, and link to route contracts, schemas and configuration instead of copying them. Before adding a sentence, check whether it states a guarantee or restates code: identifiers, constants, field lists, which module does what, and test mechanics belong in code, code comments or package guides. Extend the existing page before adding a second explanation of the same subject, and split a paragraph into a list or subsections once it covers several separate rules. Capture useful implementation discussions in the relevant page.

Label plans, unknowns, implementation gaps and manual prerequisites as such: an accepted ADR or a glossary entry does not prove implementation, and repository configuration does not prove deployment or provider behaviour. Record evidence and a verification date for each externally verified fact, without secrets.

## Record decisions and evidence

Write an ADR only for a decision that is hard to reverse, surprising without context, and the result of a real trade-off (the `domain-modeling` skill's test). Each ADR names the issue where it was decided and the change that implemented it. For a reversal, write a new numbered ADR that links the old one, and set the old one's status to `superseded by NNNN` with a link to the replacement while keeping its rationale.

A research page keeps its sources, observation dates, limits and reproduction artifacts. To ingest one, read it and the pages it affects, update the pages it supports, challenges or supersedes, record contradictions you cannot resolve, and add it to the [research index](../research/README.md). Intake is done when the investigation is indexed and its implications are reflected in the affected pages or recorded as unresolved. When its conclusion stops guiding the project, add a dated note linking what replaced it.

## Land a finished effort

An effort planned with the `wayfinder` skill (a map with decision tickets, often a spec and research) and then built leaves planning material behind. Cup runs wayfinder on [GitHub Issues](issue-tracker.md), where decision tickets stay in closed issues that ADRs can link; local `.scratch/` maps are for throwaway work. **Landing** moves what stays true into the wiki and retires the rest. Land an effort once its build is merged:

1. Read the map's Decisions so far and Out of scope, the spec, the research findings, and the merged code.
2. Research: copy each investigation into `research/` from where wayfinder left it (an unmerged `research/<name>` branch or `.scratch/<effort>/`). Put a dated incorporation note at the top saying what the project adopted and what is now historical, followed by a permalink to the original at its commit.
3. Decisions: write an ADR for each decision that passes the ADR test. Every other decision is visible in the code, explained on an architecture page, or no longer matters.
4. Current state: describe what was built on the architecture pages, verified against the code rather than the spec. Spec content that was not built becomes a labelled plan on the page it affects, or is dropped.
5. Vocabulary: check every term the effort introduced against the glossary.
6. Retire the planning material: close the map issue with a comment linking the landing change, or, for a local map, delete `.scratch/<effort>/` in the same change (git keeps it). Repoint every reference to it in `AGENTS.md`, package docs and code comments.

Landing is done when every line of the map's Decisions so far is accounted for (ADR, architecture page, or dropped, each listed in the commit or PR description), every research file is indexed, and nothing in the repository still references the retired planning material.

## Review the wiki's health

A health review runs on request, and on a schedule where one is set up; the docs check catches broken structure, this review catches pages that became untrue. Agree on or state the scope, then follow the index into the pages and the code they link. Look for:

- contradictions between pages, and claims the code no longer backs;
- restated code and near-duplicate explanations across pages;
- missing relationships or cross-component flows;
- orphan pages, missing index entries, and concepts mentioned without a page;
- decisions without an implementation, and research whose conclusions no longer match the code;
- current-state pages over their size budget.

Verify external facts with provider evidence or keep them as explicit unknowns. Report the findings as one issue on the [tracker](issue-tracker.md), each with page and source references, confirmed mismatches apart from open questions, and what you did not cover; fixes follow as their own changes.

## Compact

Pages build up the way code does. Suggest compaction when you notice overlapping explanations, current-state pages restating code, obsolete detail hiding the behaviour, or an index that is hard to scan. Within an authorized change, rewrite decayed pages, merge duplicates, delete pages that stopped mattering, and move a cluster of related pages into a subdirectory with its own `README.md` index.

Keep each rule in one home, such as the glossary for meaning and one architecture section for behaviour, and link to it from elsewhere. Before deleting restated detail, confirm that the linked code or guide holds it; otherwise move it there. Fix every inbound link and index entry in the same pass, and keep affected concepts discoverable.

## Complete the change

New pages are indexed, moved or renamed pages have no broken inbound links, and `pnpm docs:check` passes along with the applicable repository validation. Its Markdown, local-link and Mermaid parse checks also run in `pnpm validate:fast`. These checks prove structure, not accuracy, deployment state or external URL validity, so read changed prose and diagrams once more against the code they describe.
