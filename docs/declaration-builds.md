# Declaration builds and package scopes

Cup's TypeScript packages resolve internal aliases to current source files while consumers resolve the same aliases to generated declarations. Separate package scopes keep source imports live even when old declaration files exist. Build preparation removes stale declarations before the compiler emits their replacements.

## Source and declaration scopes

The root package manifest retains source-only imports for tests, scripts, and configuration outside `src`. A checked-in `src/package.json` supplies source-local imports and `type`. Test directories share the root package scope because import targets cannot point outside their defining scope with `../`. Root exports continue pointing consumers to generated declarations under their `types` condition.

Declaration builds set `rootDir: "./src"`, so declarations land directly in `dist/types`. The [preparation CLI](../tooling/prepare-declaration-build/README.md) mirrors `src/package.json` to `dist/types/package.json` and rewrites local imports to declaration targets. This gives emitted declarations their own package scope while preserving the relative layout of source modules. The CLI reference documents the exact mapping rules.

See the conversion contracts library's [root manifest](../libs/conversion-contracts/package.json), [source manifest](../libs/conversion-contracts/src/package.json), and [build configuration](../libs/conversion-contracts/tsconfig.build.json) for a complete example.

## TypeScript extension imports

When source code imports TypeScript extensions through a generic wildcard mapping such as `"#src/*": "./*"`, its compiler configuration extends the shared [type-stripping preset](../.patricktree-stack/tooling/config-typescript/tsconfig.typescript-execution-via-type-stripping.json), which enables `allowImportingTsExtensions`. The preset does not enable extension rewriting: declaration imports retain their source specifiers for resolution through the generated manifest. Explicit extension mappings remain supported for projects without it.

## Build ordering and caching

Run preparation before `tsc --build`, including when the build also checks tests that consume emitted declarations. Clearing the declaration directory removes outputs left behind by renamed or deleted source files; clearing build metadata makes the compiler regenerate the declaration tree.

Declare `@cup/prepare-declaration-build` as a workspace development dependency so changes to it invalidate dependent builds through the existing Turbo dependency graph. The [shared TypeScript task configuration](../.patricktree-stack/tooling/config-turbo-typescript/turbo.jsonc) builds dependencies first and caches `dist/**` and build metadata. Cleanup runs only when the Turbo task executes; cache hits restore the declaration tree and its generated manifest.

Use the [CLI invocation and constraints](../tooling/prepare-declaration-build/README.md#usage) when configuring a package's build script. Run [repository validation](../AGENTS.md#validation) after changing package scopes or build configuration.
