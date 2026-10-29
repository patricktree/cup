---
status: accepted
---

# Cut source material at the visible headline and carry the source subtitle in the narration document

Many source pages set a [source subtitle](../GLOSSARY.md#source-subtitle) beneath the visible headline. Before this decision cup did not know about it: narration content selection kept it only by chance, spoke it as an ordinary body unit, sometimes fused with a kicker above the visible headline, and the detail view styled it as body text. Source preparation also took the first `<h1>` in the DOM as the source title, so a hidden heading could become it. [patricktree/cup#109](https://github.com/patricktree/cup/issues/109) decided how the source subtitle is detected and [patricktree/cup#118](https://github.com/patricktree/cup/issues/118) how it travels to the listener (both 2026-10-28, specified in [patricktree/cup#121](https://github.com/patricktree/cup/issues/121)). [patricktree/cup#130](https://github.com/patricktree/cup/pull/130) implemented it, built from the tickets [patricktree/cup#126](https://github.com/patricktree/cup/issues/126) to [patricktree/cup#129](https://github.com/patricktree/cup/issues/129).

## Decision

- **The cut happens in source preparation.** The browser marks the visible headline, the first `<h1>` that renders visibly, and source preparation takes the source title from it. The source material it hands on leaves out everything before the visible headline in document order, the visible headline, and the source subtitle element, removed by identity rather than by text. Content selection never sees kickers, eyebrows, hub links, dates above the title, the visible headline or the source subtitle. Without a visible headline the source title falls back to `document.title`, nothing is cut, and there is no source subtitle.
- **Deterministic detection.** The source subtitle is the first prose block after the visible headline, skipping date and byline blocks, accepted only when it exactly equals a metadata description or carries a subtitle-like attribute word. Otherwise there is none: precision beats recall, and a missing source subtitle never fails or delays a conversion.
- **The narration document is the only carrier.** With a source subtitle the narration document opens with an `<hgroup>` holding the source title as unit 1 and the source subtitle as unit 2, each its own synchronization unit; unit 2 never absorbs a heading or merges with the next block. Without one the opening is the source title alone, as before. The audiobook manifest, the listener API and the account and grant stores gain no field, so Recents, the player sheet and the media session show the source title only.

## Considered options

- **A structured manifest or listener API field.** Rejected: only the detail view shows the source subtitle, and it is narrated, so it belongs in the narration document with its own synchronization unit. A field would add a manifest version, a listener API change and a store column to show text the narration document already carries.
- **Markers that survive content selection.** Leaving the visible headline and source subtitle in the HTML with marker attributes for narration document creation to find was rejected: content selection reconstructs the source material and need not keep markers or the marked elements, and a kicker above the visible headline would still reach it.
- **LLM-based detection.** Rejected: deterministic rules were right on all seven recorded source pages, cost nothing and add no latency. An LLM fallback would be a separate, later effort.

## Relationship to existing decisions

This amends [ADR 0001](0001-use-a-canonical-synchronized-audiobook.md)'s "speaks the source title as its first unit": the source title is still the first unit, and a source subtitle, when there is one, is the second. [ADR 0005](0005-prepare-narration-before-player-controlled-synthesis.md)'s "the source title is the first spoken unit" still holds.

## Consequences

- Conversions prepared before this decision have no source subtitle and are not backfilled; their narration documents keep the subtitle-like line, if any, as a body unit.
- Narration content selection eval inputs must be in the prepared shape, with the visible headline and source subtitle already removed, and their goldens change.
- The [recorded source pages](../../libs/prepare-source-material/test-e2e/fixtures/README.md) and [narration document tests](../../libs/narration-document-creation/test/narration-document-creation.test.ts) cover the cut, the detection and the opening.
