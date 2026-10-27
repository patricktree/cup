# Workspace checks

Tests for invariants that span every workspace package. `pnpm validate:fast` runs them with the other package tests; run them alone with `pnpm --filter @cup/workspace-checks test`.

## Package export check

The [package export test](test/package-exports.test.ts) lists the workspace projects with `pnpm ls --recursive --json --depth -1`, reads each `package.json`, and applies the [rule](src/package-exports.ts) to every project except the repository root and `.patricktree-stack`:

- In `apps/` and `libs/`, a subpath export whose target lies in `src/` is production code, unless the target is a `*.fake.ts` test double. Re-export production code from `.`, or list the subpath with its reason under `cup.subpathExportExceptions` in the same `package.json`.
- An entry in `cup.subpathExportExceptions` that no production subpath export needs fails the check, so stale exceptions do not accumulate.
- A `.` export whose file re-exports other files of the package must be `src/index.ts`.

Packages in `tooling/` and `qa/` hold no production code, so the check accepts any of their subpath exports. The [system overview](../../docs/architecture/README.md#responsibilities-and-code-boundaries) explains why the rule exists.
