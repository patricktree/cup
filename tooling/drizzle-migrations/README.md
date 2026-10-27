# Drizzle migrations

This package holds the SQLite migration generator that the `migrations:generate` scripts of [accounts](../../libs/accounts/README.md#database-migrations), [conversion grants](../../libs/conversion-grants/README.md#change-a-schema), and the [registry](../../libs/registry/README.md#database-migrations) call. Each package's `scripts/generate-migrations.mjs` names its stores and their schema files under `src/`.

For each store, the generator runs the calling package's `drizzle-kit generate` with the script's arguments, writes the SQL and snapshots to `drizzle/<store>/`, and bundles the journal and SQL into `src/migrations/<store>.ts` for the Worker. Drizzle Kit gives a `--custom` migration a copy of the previous snapshot; the generator replaces it with the current schema, so the next generation diffs against the schema that the hand-written SQL produces.

## Schema diagrams

`generateMigrations` also renders each store's entity-relationship diagram with [`schema-diagram.ts`](src/schema-diagram.ts) into the page that its `schemaDiagramPage` option names, [Durable Object database schemas](../../docs/architecture/durable-object-storage.md): every table, and one relationship per foreign key, one-to-one when the referencing columns are unique (a partial unique index does not count). It replaces the lines between the `<!-- schema-diagram:<store> -->` and `<!-- /schema-diagram:<store> -->` markers, so the prose around them stays hand-written. Each consuming package's migration test fails when the page's diagram differs from the rendered one; rerun `migrations:generate`, which regenerates the diagram even when the schema has no migration to write.

## Validation

Run `pnpm --filter @cup/drizzle-migrations build`, then run `migrations:generate` in a consuming package; an unchanged schema reports no changes. The consuming packages' migration tests verify that the checked-in snapshots match their schemas.
