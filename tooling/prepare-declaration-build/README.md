# Prepare declaration builds

This CLI removes stale declaration outputs and build metadata, then mirrors a checked-in source package manifest into the declaration directory. See [declaration builds and package scopes](../../docs/declaration-builds.md) for workspace import resolution, compiler configuration, and Turbo integration.

## Usage

```sh
prepare-declaration-build \
  --declaration-output-dir ./dist/types \
  --build-info-file ./dist/tsconfig.build.tsbuildinfo \
  --source-package-json ./src/package.json
```

Paths resolve from the current working directory. Repeat `--build-info-file` for additional build metadata. The CLI reads no TypeScript configuration and discovers no workspace packages. Its executable runs directly from TypeScript source through Node's type stripping.

Cleanup paths must remain inside the current package. The declaration directory must be outside the source manifest's directory, and build metadata paths must end in `.tsbuildinfo`. Manifest parsing and rewriting complete before deletion begins.

## Manifest rewriting

The source manifest is copied with local `imports` targets rewritten from source to declaration extensions, and generic mappings such as `"#src/*": "./*"` gain explicit declaration mappings; the [rewriter](src/prepare-declaration-build.ts) holds the rules. Other manifest fields remain unchanged.

The CLI writes the generated manifest to `package.json` inside the declaration output directory. Local imports retain their relative layout; the CLI does not rebase targets or copy assets.

## Validation

To validate this package, run `pnpm --filter @cup/prepare-declaration-build build` and `pnpm --filter @cup/prepare-declaration-build test`.
