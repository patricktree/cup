# Package export rule enforcement

Research date: 2026-10-27. Repository observations are from commit `c63c7fe` (branch `claude/monorepo-exports-audit-92f37d`, PR [#53](https://github.com/patricktree/cup/pull/53)); tool versions are those installed there or the latest release on that date.

## Question

The [architecture overview](../architecture/README.md#responsibilities-and-code-boundaries) states that every workspace package exposes production code only through its `.` export, pointing to `src/index.ts` when the package re-exports more than one file. Other subpaths are allowed only for code production does not run (`./fake`, `@cup/web-app` `./vite`, `@cup/brand-assets` `./cup.svg`, `@cup/drizzle-migrations` `./schema-diagram`, `./package.json`), plus the Durable Object exceptions `@cup/accounts` `./contracts`, `./lifecycle`, `./artifact-writer` and `@cup/conversion-grants` `./contracts`, `./session`. The [wiki schema](../agents/domain.md) asks for such a rule to live in a check that the page names. Which check fits?

## Current state

At `c63c7fe`, every workspace package with an `exports` field matches the rule. Three single-file packages point `.` to their one module instead of `src/index.ts`: `@cup/mp3-encoding`, `@cup/narration-document-creation` and `@cup/resend-stub`; `@cup/drizzle-migrations` does the same with `src/generate-migrations.ts`.

Two observations a check must handle:

- `@cup/config-oxlint` (`tooling/config-oxlint`) has no `exports` field, and all 30 `oxlint.config.ts` files, the root one included, import `@cup/config-oxlint/oxlint-base.js`. Without `exports`, every file of the package is importable, so the rule is not stated for it. It is build configuration, so either it gets `exports: { "./oxlint-base.js": ... }` or the rule names it as an exception.
- Each package has a `src/package.json` holding only `type` and `imports` (the `#src/*` alias). A check that globs `**/package.json` must skip these; enumerating `pnpm-workspace.yaml` packages avoids them.

## Option 1: lint `package.json` itself

**oxlint cannot lint JSON.** The installed version is oxlint 1.87.0. Its lintable extensions are `js`, `mjs`, `cjs`, `jsx`, `ts`, `mts`, `cts`, `tsx` plus partially loaded `vue`, `astro`, `svelte` ([`VALID_EXTENSIONS`](https://github.com/oxc-project/oxc/blob/main/crates/oxc_span/src/source_type.rs), [`LINTABLE_EXTENSIONS`](https://github.com/oxc-project/oxc/blob/main/crates/oxc_linter/src/loader/partial_loader/mod.rs)). Running the installed binary on a `.json` file prints "No files found to lint".

**oxlint JS plugins cannot add a JSON parser.** The repository already uses `jsPlugins` (`eslint-plugin-react-you-might-not-need-an-effect` in `.patricktree-stack/tooling/config-oxlint/oxlint-base.js`). The [JS plugins guide](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) calls the feature alpha and lists "custom file formats and parsers" and type-aware rules as not yet supported. So `eslint-plugin-package-json` or `eslint-plugin-jsonc` cannot run under oxlint.

**ESLint plugins have no rule for this.** [eslint-plugin-package-json](https://github.com/michaelfaith/eslint-plugin-package-json) 1.12.0 (released 2026-10-27; parser `jsonc-eslint-parser`, peer `eslint >= 9`) offers `valid-exports` (shape), `require-exports`, `exports-subpaths-style` (implicit compared with explicit `.`), `require-package-json-export` and `restrict-top-level-properties` (top-level keys only). None restricts which subpath keys exist or where they point. [eslint-plugin-jsonc](https://github.com/ota-meshi/eslint-plugin-jsonc) 3.4.2 has only syntax and style rules (`docs/rules` lists no restriction rule). Its parser exposes a JSON AST that ESLint selectors can address, so core `no-restricted-syntax` could in principle flag `JSONProperty` keys under `exports`. Encoding a per-package allowlist in selectors would need one config block per package. That last point is inference; I did not build it. Every route here also adds ESLint as a second linter beside oxlint, only for `package.json`.

## Option 2: restrict imports of `@cup/*` subpaths

**oxlint `no-restricted-imports` can express the allowlist.** The [rule docs](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports.html) list `paths`, `patterns` with `group` (gitignore-style) or `regex` (Rust syntax, no lookaround), `importNames`, `allowImportNames`, `allowTypeImports` and `message`. The [rule source](https://github.com/oxc-project/oxc/blob/main/crates/oxc_linter/src/rules/eslint/no_restricted_imports.rs) handles `!` negation in `group` and tests it (`["foo/*", "!foo/bar"]`). A scratch run with oxlint 1.87.0 and `group: ["@cup/*/**", "!@cup/*/fake", "!@cup/accounts/contracts", "!@cup/web-app/vite"]` flagged `@cup/registry/src/foo` and `@cup/accounts/lifecyclez` and allowed `@cup/accounts/contracts`, `@cup/audiobook-production/fake`, `@cup/web-app/vite` and `@cup/registry`. The repository's per-package overrides already extend this rule (for example `libs/conversion-contracts/oxlint.config.ts` from [#51](https://github.com/patricktree/cup/pull/51)), but each override must re-spread the shared options, because a package-level setting replaces the base one.

**Other import rules are unavailable or ill-suited.** oxlint has no `import/no-internal-modules` or `import/no-restricted-paths`: the [import rules directory](https://github.com/oxc-project/oxc/tree/main/crates/oxc_linter/src/rules/import) has neither. [eslint-plugin-import-x](https://github.com/un-ts/eslint-plugin-import-x) 4.17.1 has both: `no-internal-modules` takes `allow` or `forbid` globs, and `no-restricted-paths` restricts by resolved file-path zones. [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) 7.3.0 classifies files into elements and writes dependency policies between them. All three are ESLint plugins that resolve imports through ESLint resolver settings. Whether they run as oxlint JS plugins is unverified.

**Import-side checks duplicate what `exports` already enforces.** Under `moduleResolution` `node16`, `nodenext` or `bundler`, "the presence of `"exports"` prevents any subpaths not explicitly listed or matched by a pattern in `"exports"` from being resolved" ([TypeScript modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html#packagejson-exports)). The shared tsconfigs use `Node16` and, for Workers, `bundler` (`.patricktree-stack/tooling/config-typescript`). So the type check already rejects an import of an unlisted subpath. The rule actually concerns which entries `package.json` declares. An import restriction catches a disallowed subpath only once someone imports it, so a new `./internal` entry with no consumer passes. It also duplicates the allowlist in a second place. The gap matters, because the declaration is the thing the rule governs.

## Option 3: Knip

Knip 6.41.0 is installed. Knip reads the `exports` field as a source of entry files ([entry files](https://knip.dev/explanations/entry-files)), which makes their targets count as used. Its [issue types](https://knip.dev/reference/issue-types) cover files, dependencies, code exports, catalogs, duplicates and cycles; none concerns `package.json` `exports` entries, so Knip neither flags a disallowed subpath nor an unused one. `includeEntryExports` reports unused code exports inside entry files ([configuration](https://knip.dev/reference/configuration)), not entries of the field.

## Option 4: Turborepo Boundaries

turbo 2.11.7 is installed. [Boundaries](https://turborepo.dev/docs/reference/boundaries) is marked experimental. It reports imports of files outside the package directory and imports of undeclared dependencies, and with tags it restricts which packages may depend on which. It works at package granularity; the documentation describes no subpath or `exports` check.

## Option 5: a Vitest test over the workspace manifests

A test that reads each workspace `package.json` checks the declaration directly, including entries nobody imports. Precedent: the library-layers package from #51 (commit `56b30a7`, later removed in `42a8d51` because Boundaries and the dependency cycle covered its rule). It held a pure `findLayerConfigProblems` function of about 50 lines in `tooling/library-layers/src/` and a Vitest test that read the configs with `jsonc-parser` and `zod`. The schema-diagram checks from the same PR also live as Vitest tests next to the code they guard.

Sketch, about 60 to 80 lines of source and test, in a `tooling/package-exports` package (or a test in an existing tooling package):

- List workspace directories from the `packages` globs in `pnpm-workspace.yaml`, skipping `.patricktree-stack/**`, so nested `src/package.json` files never enter.
- For each package with `exports`, keep a `{ packageName: allowedSubpaths }` allowlist next to the check: `./package.json` everywhere, `./fake` anywhere, plus the named build, asset, tooling and Durable Object exceptions. Report every key outside it.
- For `.`, report a `default` target other than `./src/index.ts` when that target contains an `export … from` re-export, or when `src/index.ts` exists. A regular expression is enough for the current files; the TypeScript compiler API is the stricter alternative.
- Decide `@cup/config-oxlint`: require `exports` on every package that other packages import, or list it as a build-configuration exception.

The test runs in `turbo:test` and therefore in `pnpm validate:fast`, and the architecture page then names it.

Note (2026-10-27): [pnpm workspace project listing](pnpm-workspace-project-listing.md) recommends enumerating the projects with `pnpm ls -r --json --depth -1` instead of parsing the `packages` globs, since pnpm 12 Rust crates are unpublished.

## Recommendation

Use a Vitest test that reads every workspace `package.json` (Option 5). It is the only option that checks the declaration the rule governs, catches entries without consumers, and needs no new linter. oxlint cannot parse JSON, its JS plugins cannot add a parser, and no published ESLint rule restricts `exports` keys. TypeScript's `exports` resolution already rejects unlisted subpaths at the import site, so a `no-restricted-imports` allowlist adds little and repeats the allowlist. Fix the `@cup/config-oxlint` gap in the same change.

## Limits

- I did not run ESLint with `jsonc-eslint-parser` and `no-restricted-syntax`, nor the import-x and boundaries plugins under oxlint `jsPlugins`. Those statements rest on documentation and inference.
- The Turborepo and Knip conclusions rest on what their documentation omits. I did not read their source.
- Release versions are from GitHub releases on the research date; the oxlint rule and extension claims come from `main` of `oxc-project/oxc` on that date and from a local run of 1.87.0.
