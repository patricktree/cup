# Conversion grants

## Layout

`src/index.ts` is the package's interface; the `./contracts` and `./session` exports in `package.json` point into `domain/`. `src/encoding.ts` and `src/time.ts` are shared pure helpers that import nothing else from the package. The folders:

- `domain/`: the grant snapshot and conversion schemas (`grant-contracts.ts`), the grant record, its conversions and the rules that derive state, duration balance and snapshots from them (`grant-model.ts`), and the root credential and session signing with Web Crypto (`grant-session.ts`), with no storage or bindings. It imports only `domain/` and the shared helpers.
- `storage/`: the Durable Object SQLite adapter: the Drizzle schema (`grant-sqlite-schema.ts`, `rate-limit-schema.ts`), the legacy transition and migration entry point (`legacy-grant-migrations.ts`), and `ConversionGrantSqlite` (`grant-sqlite.ts`), which maps rows to `domain/` types. It imports `domain/`, never `durable-object/` or `src/index.ts`.
- `durable-object/`: the Cloudflare glue: `ConversionGrantDurableObject`, its environment bindings, the RPC methods and alarm that hold the grant use cases, and the narrow registry RPC interface (`grant-registry.ts`). Only `src/index.ts` imports it; it reaches the generated migrations only through `storage/`.
- `migrations/`: the generated Worker bundle of the grant migrations; `pnpm --filter @cup/conversion-grants migrations:generate` writes it there. Only `storage/` and tests import it.

Tests stay flat in `test/` and import the Durable Object through `#src/index.ts`. [`oxlint.config.ts`](oxlint.config.ts) enforces these import directions with `no-restricted-imports`; place a new file in the folder of its role, and extend the overrides there when you add a folder.

## Migrations

See the [README](README.md) to change a schema or renumber a migration.
