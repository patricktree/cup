# Drizzle migrations

This package holds the SQLite migration generator that the `migrations:generate` scripts of [accounts](../../libs/accounts/README.md#database-migrations), [conversion grants](../../libs/conversion-grants/README.md), and the [registry](../../libs/registry/README.md#database-migrations) call. Each package's `scripts/generate-migrations.mjs` names its stores and their schema files under `src/`.

For each store, the generator runs `drizzle-kit generate` with the script's arguments, writes the SQL and snapshots to `drizzle/<store>/`, and bundles the journal and SQL into `src/migrations/<store>.ts` for the Worker. Drizzle Kit gives a `--custom` migration a copy of the previous snapshot; the generator replaces it with the current schema, so the next generation diffs against the schema that the hand-written SQL produces.

To validate this package, run `pnpm --filter @cup/drizzle-migrations build` and regenerate migrations in a consuming package; an unchanged schema reports no changes.
