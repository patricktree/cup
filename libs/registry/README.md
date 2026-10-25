# Registry

Registry account provisioning and deletion require `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, and `RESEND_BASE_URL`. Provisioning always checks the provider identity before activation; integration tests supply a local identity provider. Deletion notice tests send to a [Resend stub](../../qa/resend-stub/src/resend-stub.ts) started per test, and a [holding `ACCOUNTS` double](test/holding-accounts.ts) pins calls that land on the coordinator while it awaits an account.

This library owns the singleton `RegistryDurableObject`: provider identity mapping, account provisioning, grant inventory, grant and account usage projections, conversion ownership, ingress rate limits, and durable account deletion coordination and notifications. Account and grant objects keep their owner-specific conversion state and accounting. Integration tests here exercise all three Durable Object classes together.

The shared `REGISTRY` binding resolves the existing singleton name `registry`. `conversion_owners` is the sole mapping from each conversion ID to an account or trial grant, with a check constraint requiring exactly the matching owner identifier. The undeployed unified baseline contains no `conversion_grants` table or compatibility lookup; the legacy table is dropped during the transition.

## Preserve deployed storage

The account registry was never deployed. Its coordination tables are folded into the existing grant registry's database. The [Worker configuration](../../apps/cloudflare-worker/wrangler.jsonc) retains deployed `v1` and adds a `renamed_classes` migration from `ConversionGrantRegistryDurableObject` to `RegistryDurableObject`. Cloudflare [rename migrations](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/#rename-migration) preserve the source class's stored data. Do not create a new namespace for the renamed class or change the singleton name.

The [SQLite transition](src/storage/sqlite-migrations.ts) atomically preserves legacy grant inventory from registry schema version 3, discards old conversion mappings, applies the unified baseline, and records the Drizzle journal. This retains [ADR 0004](../../docs/adr/0004-preserve-only-grants-during-drizzle-transition.md)'s grant-only retention policy. The account coordination tables and `conversion_owners` are part of the undeployed unified baseline. Applied grant-object migrations remain unchanged in conversion-grants.

## Database migrations

Schemas: [grant inventory, conversion ownership, and account coordination](src/storage/registry-sqlite-schema.ts), and [rate limits](src/storage/rate-limit-schema.ts). See the [database diagrams](../../docs/architecture/durable-object-storage.md#registry) and [generated migrations](drizzle/registry/).

After editing schemas, generate and verify migrations:

```sh
pnpm --filter @cup/registry migrations:generate --name describe_change
pnpm --filter @cup/registry test
pnpm validate:fast
```

Once deployed, append migrations instead of rewriting the baseline. Drizzle Kit rebuilds a table to add a constrained column and copies the new column from the old table, which lacks it; list only the existing columns in the copy, as the [account usage projection](drizzle/registry/0001_account_usage_projection.sql) does. Tests verify schema snapshots and bundled SQL, legacy preservation and migration replay, ownership conflicts, and account provisioning and deletion alongside trial grants.

If a rebase leaves two branches' migrations with the same number, follow [Renumber a migration after a rebase](../accounts/README.md#renumber-a-migration-after-a-rebase) with `@cup/registry`.
