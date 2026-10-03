# Search Cup documentation

Use QMD to discover supporting documentation, including related descriptions that use different wording. Concept and behavior changes require conceptual retrieval even when the [documentation index](../../docs/README.md) makes the obvious page easy to find; follow the [documentation search procedure](../../docs/agents/domain.md#find-supporting-documentation) for triggers and completion checks. Use `rg` for exact code identifiers and paths. Search results locate evidence; read the current document and linked implementation before relying on a claim.

## Run searches

After `pnpm install`, run these commands from the repository root:

```sh
# Keyword search: no embedding or reranking models required.
pnpm docs:search search "media session" --json

# Semantic similarity, with embeddings refreshed first.
pnpm docs:search vsearch "How does signing out stop private audio?" --json

# Hybrid search, including query expansion and reranking.
pnpm docs:search query "Why does a failed conversion still consume allowance?" --json

# Search operational guides or historical evidence explicitly.
pnpm docs:search query "How do I configure local sign-in?" -c cup-guides --json
pnpm docs:search query "Why charge by audio duration?" -c cup-decisions --json
pnpm docs:search search "Gemini" -c cup-research --json
```

Searches default to current documentation and return at most five results. Choose another collection explicitly for procedures, decisions, or research; this keeps a historical recommendation from outranking current behavior by default. Hybrid queries also supply Cup's audiobook and duration-allowance context to disambiguate terms such as conversion from financial terminology. Omit `--json` for readable terminal output. The wrapper sends index-refresh progress to stderr and search results to stdout. For a clean JSON file, use `pnpm --silent docs:search search "media session" --json > /tmp/cup-search.json`.

From a nested directory, use `pnpm --workspace-root docs:search ...`. The wrapper always selects the checkout containing its own source, regardless of the caller's working directory or inherited QMD index settings. It prints that checkout path to stderr.

## Setup and storage

[The collection configuration](../../.qmd/index.yml) is committed. `cup-docs` indexes Markdown under `docs/` except ADRs and research, which have their own `cup-decisions` and `cup-research` collections. `cup-guides` indexes the root and selected application, infrastructure, tooling, and QA READMEs. Collection contexts label the role and authority of the results. Code, credentials, and experiment archives are outside these masks.

The wrapper runs QMD 2.8.3 through pnpm's isolated `dlx` environment with its required TypeScript 5 peer. Cup's compiler remains unchanged. First use needs network access for the tool and native dependencies; semantic commands additionally download QMD's default local models. pnpm caches the tool, and QMD shares downloaded model files in its user cache. No hosted AI service is used for retrieval. See [QMD's requirements and models](https://github.com/tobi/qmd#requirements) for platform prerequisites and resource requirements.

Each checkout stores its own generated SQLite index and vectors under `.qmd/`, ignored by Git. The configuration uses checkout-relative collection paths, so a new worktree starts with an independent index of its own files. Switching branches within the same checkout is handled by refreshing before the next search. Downloaded models can be shared because they contain model weights, not a checkout's indexed documents.

## Refresh and inspect

```sh
pnpm docs:search refresh --lexical
pnpm docs:search refresh
pnpm docs:search status
```

Every search runs `qmd update`; semantic and hybrid searches then run `qmd embed` for content needing embeddings. A refresh failure stops the search. `status` only inspects the selected index. This does not provide an atomic snapshot against an editor changing files mid-search, so verify results against the current files.

A checkout-local lock serializes wrapper operations by rejecting overlapping invocations. If a process was forcibly interrupted and a later command reports a stale `.qmd/run.lock`, confirm that the previous wrapper and its QMD child have stopped before removing the empty lock directory. Other worktrees have separate locks. Use this wrapper consistently; raw QMD commands bypass its lock and refresh guarantees.

## Check retrieval quality

```sh
# Three keyword cases; no model inference.
pnpm docs:search check --lexical

# Also run three conceptual questions with hybrid retrieval.
pnpm docs:search check
```

[The retrieval cases](retrieval-checks.json) cover authentication, account deletion, and duration accounting. Each requires its expected architecture page in the first three results. Missing pages, invalid results, or failed commands produce a nonzero exit. These are small regression checks, not a comprehensive search-quality benchmark; add representative questions when a real retrieval miss appears, and review expected pages when documentation moves.

QMD indexing, model downloads, inference, and retrieval checks are on demand and outside `validate:fast` and `validate:extended`. The wrapper's ordinary type and lint checks remain part of repository validation. Markdown and local-link checks continue through `pnpm docs:check`.

## Agent access

Use the CLI wrapper initially. QMD also supports MCP, but a shared server must be explicitly associated with the intended checkout and needs a refresh policy; a global server can otherwise return another branch's documents. No MCP server or background daemon is configured here. Follow the [documentation maintenance instructions](../../docs/agents/domain.md) when turning retrieved evidence into an answer or documentation update.
