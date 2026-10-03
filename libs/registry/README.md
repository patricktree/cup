# Registry

This library owns the singleton `RegistryDurableObject`: provider identity mapping, account provisioning, grant inventory and projections, conversion ownership, ingress rate limits, and durable account deletion coordination and notifications. Account and grant objects keep their owner-specific conversion state and accounting. Integration tests here exercise all three Durable Object classes together.

The shared `REGISTRY` binding resolves the existing singleton name `registry`. `conversion_owners` is the sole mapping from each conversion ID to an account or trial grant, with a check constraint requiring exactly the matching owner identifier. The undeployed unified baseline contains no `conversion_grants` table or compatibility lookup; the legacy table is dropped during the transition.

## Preserve deployed storage

The account registry was never deployed. Its coordination tables are folded into the existing grant registry's database. The [Worker configuration](../../apps/cloudflare-worker/wrangler.jsonc) retains deployed `v1` and adds a `renamed_classes` migration from `ConversionGrantRegistryDurableObject` to `RegistryDurableObject`. Cloudflare [rename migrations](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/#rename-migration) preserve the source class's stored data. Do not create a new namespace for the renamed class or change the singleton name.

The [SQLite transition](src/sqlite-migrations.ts) atomically preserves legacy grant inventory from registry schema version 3, discards old conversion mappings, applies the unified baseline, and records the Drizzle journal. This retains [ADR 0004](../../docs/adr/0004-preserve-only-grants-during-drizzle-transition.md)'s grant-only retention policy. The account coordination tables and `conversion_owners` are part of the undeployed unified baseline. Applied grant-object migrations remain unchanged in conversion-grants.

## Database migrations

Schemas: [grant inventory, conversion ownership, and account coordination](src/registry-sqlite-schema.ts), and [rate limits](src/rate-limit-schema.ts). See the [database diagrams](../../docs/architecture/durable-object-storage.md#registry) and [generated migrations](drizzle/registry/).

After editing schemas, generate and verify migrations:

```sh
pnpm --filter @cup/registry migrations:generate --name describe_change
pnpm --filter @cup/registry test
pnpm validate:fast
```

Once deployed, append migrations instead of rewriting the baseline. Tests verify schema snapshots and bundled SQL, legacy preservation and migration replay, ownership conflicts, and account provisioning and deletion alongside trial grants.
