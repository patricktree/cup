# Run narration content selection evals

These evals compare the synchronization units produced by narration content selection candidates against committed input and best-output pairs. Each candidate's selected HTML passes through the same narration document creation used by the production workflow. The production candidate is a regression gate. Experimental candidate mismatches are recorded as scores without failing the run.

Live evals call Gemini through Cloudflare AI Gateway and can incur usage charges. They run separately from the package's unit tests and repository validation.

## Configure credentials

The root [environment setup](../../../../AGENTS.md#environment-setup) creates `.env.evals`. The production candidate uses `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY`. An experimental candidate can supply a different `SelectionCompletion` implementation and its required credentials. The local environment file is optional and ignored by Git; you can instead export the required credentials. Evals do not require the Worker’s environment file.

## Add an eval case

Create a descriptive directory under `test/evals/cases/` with this structure:

```text
<case-id>/
  source-title.txt
  source-subtitle.txt  # optional
  input.html
  expected.json
  case.json            # optional
```

Put the title returned by source material preparation in `source-title.txt` and the accepted audiobook source material in `input.html`. When source material preparation detects a source subtitle on the page, put it in `source-subtitle.txt`; leave the file out when the page has none. The harness passes the source title and source subtitle to narration document creation, just as the production workflow does.

`input.html` has the prepared shape that content selection receives in production. When the page has a visible headline, preparation cuts everything before the headline, the headline itself, and the source subtitle element, so `input.html` contains none of them. Derive a new case's `input.html` from what `prepareLoadedSourcePage` in `libs/prepare-source-material` returns for the page.

Put the best synchronization units in `expected.json`. The golden is a JSON array containing each unit's `id` and `narrationText`. It opens with the source title as unit `narration-unit-0001`; with a source subtitle, the source subtitle follows as unit `narration-unit-0002` and the selected content starts at `narration-unit-0003`.

Optional `case.json` metadata accepts only `description` and `tags`:

```json
{
  "description": "Keeps the source content while excluding navigation.",
  "tags": ["long-form", "navigation-noise"]
}
```

Missing partner files, invalid metadata, and an empty eval case set fail during suite discovery.

## Run and update evals

From the repository root, run `pnpm validate:evals`. This paid check is excluded from `pnpm validate`. Alternatively, from `libs/narration-content-selection`, run all registered candidates:

```sh
pnpm eval
```

The production candidate must match every committed golden. Other candidates receive exact-match scores without gating the command. Runs execute sequentially without retries.

Update goldens from only the production candidate:

```sh
pnpm eval:update
```

Review changed `expected.json` files with Git before accepting them. To run one case, pass its ID to Vitest:

```sh
pnpm eval -t <case-id>
```

Generated JSON reports are written to `generated/evals/vitest-results.json`. Open the latest report with:

```sh
pnpm eval:report
```

## Add an experimental candidate

Add a named candidate to `CANDIDATES` in `test/evals/narration-content-selection.eval.ts`. Each candidate owns the complete AI strategy: its model-backed completion function, system prompt, tool definition, and completion options such as reasoning effort, token limit, and retries.

Start experiments by spreading the production configuration and overriding only the variables under test:

```ts
{
  ...PRODUCTION_CONFIG,
  name: "medium-reasoning-effort",
  role: "experiment",
  systemPrompt: `${PRODUCTION_CONFIG.systemPrompt}\nFavor concise output.`,
  tool: {
    ...PRODUCTION_CONFIG.tool,
    description: "Select the element IDs for a concise narration.",
  },
  completionOptions: {
    ...PRODUCTION_CONFIG.completionOptions,
    reasoningEffort: "medium",
  },
}
```

Every candidate still runs through the same HTML identification, Zod response validation, ordering, filtering, narration document creation, and synchronization-unit chunking implementation. The repository-owned harness runs that complete workflow and normalizes its transcript, usage, timing, and artifacts for `vitest-evals`.
