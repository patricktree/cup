# Run narration source analysis evals

These evals cover both parts of narration source analysis in one suite. The narration content selection evals compare the synchronization units produced by narration content selection candidates against committed input and best-output pairs. Each candidate's selected HTML passes through the same narration document creation used by the production workflow. The [narration language detection evals](#narration-language-scenarios) compare the language a detection candidate decides for each case against a hand-authored expected language. In both, the production candidate is a regression gate. Experimental candidate mismatches are recorded as scores without failing the run.

Live evals call Gemini through Cloudflare AI Gateway and can incur usage charges. They run separately from the package's unit tests and repository validation.

## Configure credentials

The root [environment setup](../../../../AGENTS.md#environment-setup) creates `.env.evals`. The production candidate uses `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY`. An experimental candidate can supply a different `Completion` implementation and its required credentials. The local environment file is optional and ignored by Git; you can instead export the required credentials. Evals do not require the Worker’s environment file.

## Add an eval case

Create a descriptive directory under `test/evals/cases/` with this structure:

```text
<case-id>/
  source-title.txt
  source-subtitle.txt  # optional
  input.html
  expected.json
  narration-language.json
  case.json            # optional
```

Put the title returned by source material preparation in `source-title.txt` and the accepted audiobook source material in `input.html`. When source material preparation detects a source subtitle on the page, put it in `source-subtitle.txt`; leave the file out when the page has none. The harness passes the source title and source subtitle to narration document creation, just as the production workflow does.

`input.html` has the prepared shape that content selection receives in production. When the page has a visible headline, preparation cuts everything before the headline, the headline itself, and the source subtitle element, so `input.html` contains none of them. Derive a new case's `input.html` from what `prepareLoadedSourcePage` in `libs/prepare-source-material` returns for the page.

A golden must be the output the production candidate gives on every run. When selection wavers over a part of the page the case is not about, cut that part from `input.html` and say so in the case's `case.json` description. The English, German and French "Ich bin ein Berliner" and Sherlock Holmes Wikipedia cases test narration language detection, so their back matter (bibliography, external links, references) is cut, and so is the English page's infobox, whose caption repeats the title: selection included them in some runs and left them out in others.

Put the best synchronization units in `expected.json`. The golden is a JSON array containing each unit's `id` and `narrationText`. It opens with the source title as unit `narration-unit-0001`; with a source subtitle, the source subtitle follows as unit `narration-unit-0002` and the selected content starts at `narration-unit-0003`.

Put the case's narration language scenarios in `narration-language.json`, as described in [narration language scenarios](#narration-language-scenarios).

Optional `case.json` metadata accepts only `description` and `tags`:

```json
{
  "description": "Keeps the source content while excluding navigation.",
  "tags": ["long-form", "navigation-noise"]
}
```

Missing partner files, invalid metadata or narration language scenarios, and an empty eval case set fail during suite discovery. The package's unit tests load the committed cases too, so `pnpm test` and every [validation gate](../../../../AGENTS.md#validation-gates) catch an invalid case without a paid run.

## Narration language scenarios

`narration-language.json` is a JSON array of scenarios. Each scenario has an optional `declaredLanguage` with the raw `htmlLang` and `ogLocale` values, as source preparation captures them, and the `expectedLanguage` as a language subtag alone, such as `de`, never `de-AT`. The region rule and the fallback chain are deterministic code with unit tests, so the evals check only the subtag the detector decides:

```json
[
  { "declaredLanguage": { "htmlLang": "de-AT" }, "expectedLanguage": "de" },
  { "expectedLanguage": "de" },
  { "declaredLanguage": { "htmlLang": "en-US" }, "expectedLanguage": "de" }
]
```

Every case has a scenario with the declared language recorded from the live page when the case is added, and a "nothing declared" scenario without `declaredLanguage`; the loader rejects a case without the latter. A contradicting scenario declares a wrong language, as a site template around an article in another language does: derStandard declared `en-US`, and the English "Ich bin ein Berliner" declared `de-DE`.

The detector reads the case's source title and the narration source material rebuilt from the committed `expected.json` without its source title and source subtitle units, not a live selection run, so a selection regression cannot fail detection. A detection that falls back, for example because the call failed, scores 0 even when the fallback language matches. Expected languages are hand-authored facts: `eval:update` never changes `narration-language.json`.

## Run and update evals

From the repository root, run `pnpm evals`. This paid check runs only when invoked: the [review gate](../../../../AGENTS.md#validation-gates) runs it only when this library or a package it depends on changed relative to `origin/main`. Alternatively, from `libs/narration-source-analysis`, run all registered candidates:

```sh
pnpm eval
```

The production selection candidate must match every committed golden, and the production detection candidate every expected language. Other candidates receive exact-match scores without gating the command. Runs execute sequentially without retries.

Update selection goldens from only the production selection candidate:

```sh
pnpm eval:update
```

Selection scores never gate the run; the file snapshot of `expected.json` gates the production candidate, so `eval:update` rewrites a golden that differs. Review changed `expected.json` files with Git before accepting them. To run one case, pass its ID to Vitest:

```sh
pnpm eval -t <case-id>
```

Generated JSON reports are written to `generated/evals/vitest-results.json`. Open the latest report with:

```sh
pnpm eval:report
```

## Add an experimental candidate

Selection and detection have separate candidate lists, so an experiment varies one without the other. Add a named selection candidate to `CANDIDATES` in `test/evals/narration-content-selection.eval.ts`. Each candidate owns the complete AI strategy: its model-backed completion function, system prompt, tool definition, and completion options such as reasoning effort, token limit, and retries.

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

Add a named detection candidate to `DETECTION_CANDIDATES` in the same file, spreading `PRODUCTION_DETECTION_CONFIG` from `src/production-narration-language-detection.ts` the same way. It runs through the same validation, canonicalization and region rule as production detection.
