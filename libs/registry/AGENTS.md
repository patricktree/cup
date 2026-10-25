# Registry

## Layout

`src/index.ts` is the package's interface and exports only `RegistryDurableObject`. `src/encoding.ts` and `src/time.ts` are shared pure helpers that import nothing else from the package. The folders:

- `domain/`: the grant inventory entry and record, the snapshot and projected-state rules, and the keyset cursors (`registry-model.ts`), with no storage, bindings, or network calls. It may import only `domain/` and the shared helpers.
- `storage/`: the Durable Object SQLite adapter: the Drizzle schemas (`registry-sqlite-schema.ts`, `rate-limit-schema.ts`), the legacy transition and migration entry point (`sqlite-migrations.ts`), `RegistrySqlite` (`registry-sqlite.ts`), which maps grant rows to `domain/` types, and `requireRow()` (`sqlite-row.ts`). It may import `domain/`, the shared helpers, and the generated migrations, and nothing above it.
- `providers/`: the outside services: the Supabase admin environment, identity check, and identity deletion (`supabase-identity.ts`), and the Resend notice send with its response classification and `Retry-After` parsing (`resend-email.ts`). Identity deletion and the notice send take the caller's `request` and timeout (`ProviderRequest`, `provider-request.ts`), so tests can drive them against local stand-ins. It may import only `domain/` and the shared helpers.
- `account-deletion/`: the account deletion use case: `DeletionCoordinator` (`deletion-coordinator.ts`) keeps deletion jobs, notices and receipts in the registry database, counts notice attempts, schedules retries with backoff inside the 23-hour deduplication window, and decides when to call account cleanup and the `providers/` for identity deletion and notices. It may import `domain/`, `storage/`, `providers/`, and the shared helpers, never `durable-object/` or `src/index.ts`.
- `durable-object/`: the Cloudflare glue: `RegistryDurableObject`, its environment bindings, and the RPC methods and alarm that hold the provisioning, grant inventory, and conversion ownership use cases and delegate account deletion to `account-deletion/`. Only `src/index.ts` imports it, and it never imports `src/index.ts` back.
- `migrations/`: the generated Worker bundle of the registry migrations; `pnpm --filter @cup/registry migrations:generate` writes it there. Only `storage/` and tests import it.

Tests stay flat in `test/` and import the Durable Object through `#src/index.ts`. [`oxlint.config.ts`](oxlint.config.ts) enforces these import directions with `no-restricted-imports`; place a new file in the folder of its role, and extend the overrides there when you add a folder.

## Migrations

See the [README](README.md) to change a schema or renumber a migration.
