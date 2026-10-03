# Search Cup documentation

Use QMD to discover supporting documentation, including related descriptions that use different wording. Concept and behavior changes require conceptual retrieval even when the [documentation index](../../docs/README.md) makes the obvious page easy to find; follow the [documentation search procedure](../../docs/agents/domain.md#find-supporting-documentation) for triggers and completion checks. Use `rg` for exact code identifiers and paths. Search results locate evidence; read the current document and linked implementation before relying on a claim.

## Run searches

After `pnpm install`, run these commands from the repository root:

```sh
# Keyword search: no embedding or reranking models required.
pnpm docs:search search "media session" --json

# Semantic similarity.
pnpm docs:search vsearch "How does signing out stop private audio?" --json

# Hybrid search.
pnpm docs:search query "Why does a failed conversion still consume allowance?" --json

# Search operational guides or historical evidence explicitly.
pnpm docs:search query "How do I configure local sign-in?" -c cup-guides --json
pnpm docs:search query "Why charge by audio duration?" -c cup-decisions --json
pnpm docs:search search "Gemini" -c cup-research --json
```

Search current documentation for implemented behavior; choose `cup-guides`, `cup-decisions`, or `cup-research` for procedures, rationale, or historical evidence. Omit `--json` for readable terminal output. To save results as JSON, use `pnpm --silent docs:search search "media session" --json > /tmp/cup-search.json`.

From a nested directory, use `pnpm --workspace-root docs:search ...`.

## Model requirements

Semantic and hybrid searches download local models on first use. Allow time and disk space for these downloads; see [QMD's requirements and models](https://github.com/tobi/qmd#requirements). Use keyword search when you do not need model inference.

## Refresh and inspect

```sh
pnpm docs:search refresh --lexical
pnpm docs:search refresh
pnpm docs:search status
```

If an interrupted command leaves a stale `.qmd/run.lock`, confirm that the previous wrapper and its QMD child have stopped before removing the empty lock directory.

## Check retrieval quality

```sh
# Keyword retrieval checks.
pnpm docs:search check --lexical

# Include conceptual retrieval checks.
pnpm docs:search check
```

Add representative questions to [the retrieval cases](retrieval-checks.json) when a real retrieval miss appears, and review expected pages when documentation moves. Run these checks explicitly when changing search behavior; they are outside repository validation.
