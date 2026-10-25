# Accounts

## Layout

`src/index.ts` is the package's interface; the `./contracts`, `./lifecycle`, and `./artifact-writer` exports in `package.json` point into `domain/`, `storage/`, and `artifacts/`. `src/encoding.ts` is a shared pure helper that imports nothing else from the package. The folders:

- `domain/`: the account schemas and types (`account-contracts.ts`): identity, snapshot, duration balance, accounting inspection, conversion start, outcomes, history, artifact writers, usage projection, and Workflow parameters, with no storage or bindings. It imports only `domain/` and the shared helper.
- `storage/`: the Durable Object SQLite adapter: the Drizzle schema (`account-sqlite-schema.ts`, `rate-limit-schema.ts`), the migration entry point (`sqlite-migrations.ts`), the required-row helper (`sqlite-row.ts`), and the Drizzle classes `AccountSqlite` (`account-sqlite.ts`), `AccountLifecycle` with the deletion attempt type and schema (`account-lifecycle.ts`), and `AccountArtifactWriters`, the writer ledger that fences and reconciles artifact writes (`account-artifact-writers.ts`). It imports `domain/`, the shared helper, and the generated `migrations/`, never `durable-object/`, `artifacts/`, or `src/index.ts`.
- `durable-object/`: the Cloudflare glue: `AccountDurableObject`, its environment bindings, the RPC methods and alarm that compose the storage classes, and the narrow registry RPC interface (`account-registry.ts`). Only `src/index.ts` imports it, and `artifacts/` imports its types; it reaches the generated migrations only through `storage/`.
- `artifacts/`: the R2 bucket proxy that callers outside the Durable Object wrap their account artifact writes with (`artifact-writer.ts`); it registers each write with the account before it reaches R2. Nothing in the package imports it; callers reach it through `./artifact-writer`. It imports `domain/`, the shared helper, and `durable-object/` only with `import type`, so the callers' Workers do not bundle the Durable Object.
- `migrations/`: the generated Worker bundle of the account migrations; `pnpm --filter @cup/accounts migrations:generate` writes it there. Only `storage/` and tests import it.

Most account rules, such as the welcome allowance, deletion transitions, and writer fencing, still live inside the Drizzle classes in `storage/`, so `domain/` holds only the contracts. Moving those rules out of the classes into `domain/` is a separate change; until then, put a new rule next to the storage class whose transaction enforces it.

Tests stay flat in `test/` and import the Durable Object through `#src/index.ts`. [`oxlint.config.ts`](oxlint.config.ts) enforces these import directions with `no-restricted-imports`; place a new file in the folder of its role, and extend the overrides there when you add a folder.

## Migrations

See the [README](README.md) to change a schema or renumber a migration.
