# Library layers

This package's test enforces the dependency directions between the libraries in `libs/` that the [system overview](../../docs/architecture/README.md#responsibilities-and-code-boundaries) draws. [`library-layers.ts`](src/library-layers.ts) places every library in one layer, from `errors`, which every library may use, through foundations such as `conversion-contracts` up to the API server, and the test reads each library's `package.json`: a dependency or dev dependency on a library in the same or a higher layer fails, naming both libraries and their layers. Dependencies on packages outside `libs/`, such as test stubs in `qa/`, are not checked.

A new library fails the test until it is added to a layer. Place it in the lowest layer above everything it depends on. When a change needs a dependency the layers forbid, such as an owner importing the registry, prefer a narrow RPC interface in the depending library, as `libs/accounts` and `libs/conversion-grants` declare for the registry, over moving libraries between layers.

Run the check with `pnpm --filter @cup/library-layers test`; it is part of `pnpm validate:fast`.
