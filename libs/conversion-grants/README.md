# Durable Object database migrations

All Cup application SQLite access uses Drizzle's Durable Object driver. Edit the table definitions, generate migrations, and validate them before changing the Worker. See [storage ownership](../../docs/architecture/README.md#storage-ownership) for the responsibilities of each object.

## Schemas and migration baselines

| Store            | Schema                                     | Migrations                         |
| ---------------- | ------------------------------------------ | ---------------------------------- |
| Conversion grant | [Grant schema](src/grant-sqlite-schema.ts) | [Grant migrations](drizzle/grant/) |

Account schemas and migrations live in [accounts](../accounts/README.md); grant inventory, conversion ownership, and registry migrations live in [registry](../registry/README.md). Application reads, writes, and synchronous database transactions use Drizzle. Durable Object alarms and transactions spanning asynchronous trial operations continue to use the Cloudflare storage API.

Fresh databases use these baselines directly. Existing production trial stores use a one-time [legacy transition](src/legacy-grant-migrations.ts) from handwritten grant schema version 5. The shared registry handles its own transition from legacy registry schema version 3. It preserves grant IDs, configured allowances, credentials, session signing keys, expiry, revocation, provisioning request IDs, labels, and inventory. It discards conversions, segment usage, start attempts, and conversion ownership routes; each grant regains its full configured allowance. Existing trial links and sessions remain valid under their existing expiry and revocation rules, but old audiobook links become unavailable. [ADR 0004](../../docs/adr/0004-preserve-only-grants-during-drizzle-transition.md) records this deliberate retention boundary.

The transition runs lazily before each object's first request or alarm, inside the same SQLite transaction as baseline creation and the Drizzle journal write. Failure rolls back that object's entire transition. Grant and registry transitions can run in either order; both advance snapshot revisions and reset projected usage, and grants schedule reconciliation when their snapshot is unconfirmed. Once migrated, subsequent starts and migration replays preserve new conversions and usage. Unsupported legacy versions or mixed migration histories fail without resetting data.

This transition does not delete R2 artifacts or terminate Cloudflare Workflow instances. Old conversion IDs no longer resolve through the registry, and grant operations requiring their discarded conversion records fail. Before rollout, finish or terminate old running workflows to avoid continuing provider work against discarded conversions. Retained R2 files may be cleaned up separately. Do not reset the Durable Object namespaces: they contain the grant credentials being preserved. Rolling back to the handwritten-migration Worker after this transition is unsupported.

## Change a schema

From a configured repository checkout with dependencies installed:

1. Edit the appropriate schema, including database constraints and indexes. SQLite text enums provide TypeScript types; add a `check` when the database must reject unsupported values.
2. Run the generator from the repository root:

   ```sh
   pnpm --filter @cup/conversion-grants migrations:generate --name describe_change
   ```

3. Review the generated SQL, snapshots, and journals under `drizzle/`, along with the generated Worker bundles under `src/migrations/`. Keep all of them in the same change. After a baseline has been deployed, add migrations instead of rewriting applied history.
4. Run validation:

   ```sh
   pnpm --filter @cup/conversion-grants test
   pnpm validate:fast
   ```

The generator runs Drizzle Kit for the grant store and embeds the SQL and journals in TypeScript bundles so Workers need no filesystem access or special SQL import rules. The [migration entry point](src/legacy-grant-migrations.ts) uses Drizzle's migrator and its `__drizzle_migrations` journal. Each Durable Object blocks incoming work until its migrations finish. Snapshot versions in grant RPC responses remain separate from the migration journal.

Tests check schema-to-snapshot agreement and bundle-to-SQL agreement. Integration tests and frozen production-schema fixtures in [registry](../registry/README.md) cover grant preservation, accounting, allowance reset, old ownership removal, transactional rollback, and preservation of conversions created after the transition. An unchanged schema produces no new migration when you rerun the generator.
