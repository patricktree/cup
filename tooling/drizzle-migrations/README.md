# Drizzle migrations

This package holds the SQLite migration generator that the `migrations:generate` scripts of [accounts](../../libs/accounts/README.md#database-migrations), [conversion grants](../../libs/conversion-grants/README.md#change-a-schema), and the [registry](../../libs/registry/README.md#database-migrations) call. Each package's `scripts/generate-migrations.mjs` names its stores and their schema files under `src/`.

For each store, the generator runs the calling package's `drizzle-kit generate` with the script's arguments, writes the SQL and snapshots to `drizzle/<store>/`, and bundles the journal and SQL into `src/migrations/<store>.ts` for the Worker. Drizzle Kit gives a `--custom` migration a copy of the previous snapshot; the generator replaces it with the current schema, so the next generation diffs against the schema that the hand-written SQL produces.

## Schema diagrams

[`schema-diagram.ts`](src/schema-diagram.ts) reads the entity-relationship diagram of one store from [Durable Object database schemas](../../docs/architecture/durable-object-storage.md) and outlines a Drizzle schema the same way: its table names and its foreign keys. Each consuming package's migration test compares the two, so a schema change that adds, drops, or renames a table or a foreign key fails until its diagram is updated.

## Validation

Run `pnpm --filter @cup/drizzle-migrations build`, then run `migrations:generate` in a consuming package; an unchanged schema reports no changes. The consuming packages' migration tests verify that the checked-in snapshots match their schemas.
