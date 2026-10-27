# Library layers

The libraries in `libs/` form layers, from `errors` at the bottom through foundations such as `conversion-contracts` up to the API server; the [system overview](../../docs/architecture/README.md#responsibilities-and-code-boundaries) draws the graph. A library may depend only on libraries in lower layers, so the account and grant owners reach the registry only through RPC, and libraries of one layer stay independent of each other.

[Turborepo Boundaries](https://turborepo.dev/docs/reference/boundaries) enforces the layers. Each library's `turbo.jsonc` carries one `layer:*` tag, and the root `turbo.jsonc` declares the layers from the bottom up under `boundaries.tags`, each denying its own tag and every tag above it. `pnpm boundaries` runs `turbo boundaries`, which fails when a library depends, directly or through another library, on a library in a denied layer. It also reports imports of undeclared packages and imports that reach outside a package's directory.

Boundaries skips a library without a tag and cannot tell a deny list that forgot a layer. This package's test covers both: it fails when a library has no layer tag or one the root does not declare, and when a layer's deny list is not its own tag followed by every layer above it, in declaration order.

A new library fails the test until its `turbo.jsonc` has a layer tag. Place it in the lowest layer above everything it depends on. When a change needs a dependency the layers forbid, such as an owner importing the registry, prefer a narrow RPC interface in the depending library, as `libs/accounts` and `libs/conversion-grants` declare for the registry, over moving libraries between layers.

Both checks are part of `pnpm validate:fast`. Run them alone with `pnpm boundaries` and `pnpm --filter @cup/library-layers test`.
