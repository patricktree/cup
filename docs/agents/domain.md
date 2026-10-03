# Domain and architecture maintenance

## Before design or implementation

Read [the domain context](../CONTEXT.md), then consult the [documentation index](../README.md) for relevant architecture pages and ADRs. Surface missing required documents. Use canonical terms in issues, specifications, tests, and implementation; resolve a missing concept's meaning and necessity before adding it to the domain context, the sole vocabulary authority.

## Find supporting documentation

Before changing, renaming, or removing a domain concept or cross-component behavior, including documentation-only changes, run `pnpm docs:search query "question" --json` through the [checkout-local wrapper](../../tooling/docs-search/README.md). Ask about meaning, behavior, and dependencies even when exact searches already found the obvious files. After a rename or removal, rerun the conceptual query and inspect relevant hits; empty results alone do not prove absence.

Read relevant results in current files and follow implementation links before editing or answering. Search rank does not establish authority. Supplement with `pnpm docs:search search "terms" --json` for keywords and `rg` for exact identifiers, paths, and remaining references. Spelling, formatting, and exact code-identifier edits without conceptual or behavioral changes can use direct lookup.

The wrapper refreshes the checkout's index and defaults to current documentation. Use `-c cup-guides`, `-c cup-decisions`, or `-c cup-research` for relevant procedures, rationale, or investigations. If QMD is unavailable, continue with the index and `rg` and report the limitation.

## Update documentation with the implementation

Update affected architecture prose and diagrams in the same change for component boundaries, authentication or authorization flows, data ownership, storage lifecycles, external dependencies, and cross-component behavior. Implementation-only details may need no documentation change. Verify retained claims against linked code.

Document responsibilities, relationships, invariants, and difficult cross-component flows; link to authoritative route contracts, schemas, and configuration for code-level details. Extend existing pages before duplicating explanations. Capture useful implementation discussions in the relevant page and use Git history for chronology.

Suggest compaction when explanations overlap, obsolete detail obscures behavior, or navigation becomes difficult. Within authorized updates, consolidate duplicates, remove obsolete current-state detail, and split or group pages as useful. Repair incoming links and indexes when moving or renaming documents, and keep affected concepts discoverable.

## Preserve decisions and evidence

Architecture describes the current checkout. Distinguish research recommendations, accepted decisions, and implemented behavior; explicitly mark plans, implementation gaps, unknowns, and manual prerequisites. Glossary entries and accepted ADRs do not prove implementation, and repository configuration does not prove deployment or provider behavior. Record evidence and verification dates for externally verified facts without secrets.

Surface conflicts with accepted ADRs. For substantive reversals, create a new numbered ADR linking the superseded decision and update the old ADR's status and replacement link while preserving its rationale. Preserve historical research findings, sources, observation dates, limitations, and reproduction artifacts; add supersession notes or decision links when conclusions stop guiding the project.

When integrating research, read the investigation and affected pages, identify claims or decisions it supports, challenges, or supersedes, and update cross-references and the research index. Intake is complete when the investigation is indexed and its implications are reflected in affected pages or explicitly recorded as unresolved contradictions.

## Review documentation health

For a health review, agree on or state the scope, then follow the index into relevant pages and implementation sources. Check stale claims, contradictions, missing relationships or cross-component flows, orphan pages, and gaps between decisions and implementation. Verify external facts with provider evidence or retain explicit unknowns. Report findings with document and source references, distinguish confirmed mismatches from open questions, and state coverage limits.

## Complete the change

Check affected prose and diagrams against implementation, resolve contradictions, and ensure new pages are indexed. Run `pnpm docs:check` and applicable repository validation. Markdown and local-link checks also run in fast validation; they establish neither semantic accuracy nor deployment state or external URL validity.
