# Documentation search

Find every page that describes a domain concept or cross-component behaviour before you change, rename or remove it, including in documentation-only changes. The obvious page is rarely the only one: the glossary, guides, package READMEs and `AGENTS.md` files restate concepts in their own words.

1. **Collect the words.** Take the term, its glossary _Avoid_ synonyms (for _conversion_: "workflow", "job"), the old names after a rename, and plain phrases a page might use for the behaviour instead.
2. **Read the current-state pages.** Pick the architecture pages that touch the area from the [index](../README.md) and read each one in full; the [size budget](domain.md#layers) keeps them small.
3. **Sweep the repository.** From the repository root, run `rg -il -e 'word' -e 'other word'` with every collected word, then read each Markdown hit and each code comment that explains the concept.
4. **Route history hits.** Hits in `docs/adr/` and `docs/research/` are dated history; handle them by [Record decisions and evidence](domain.md#record-decisions-and-evidence).

Done when every hit outside `docs/adr/` and `docs/research/` is updated or confirmed still true, and, after a rename or removal, a sweep for the old words finds only history and deliberate mentions such as the glossary's _Avoid_ lists.
