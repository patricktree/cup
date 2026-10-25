# Accounts

This library owns private account conversion history, duration accounting, lifecycle transitions, and artifact-write fencing. `AccountDurableObject` keeps its existing class name and binding. The [shared registry](../registry/README.md) owns account identity mapping, provisioning, and deletion coordination.

`AccountDurableObject` requires the `PREPARE_AUDIOBOOK_WORKFLOW` binding for preparation dispatch and retries, and the `SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW` binding for player-requested speech synthesis. The required `REGISTRY` binding uses a [narrow registry RPC interface](src/durable-object/account-registry.ts) for conversion ownership, usage projection, and deletion intent; the required `AUDIO_BUCKET` binding supports artifact reconciliation and account erasure. Integration tests in [registry](../registry/README.md) exercise account behavior against the real registry and trial grant objects.

The [account contracts](src/domain/account-contracts.ts), exported as `@cup/accounts/contracts`, define the runtime schemas for what the account returns to inspection, including its snapshot, accounting totals, history page, and artifact writers. The [operator API contracts](../operator-api.routes/src/contracts.ts) compose these schemas instead of copying them.

Shared conversion schemas and duration calculations live in [conversion-contracts](../conversion-contracts/README.md), and the duration ledger shared with conversion grants lives in [duration-ledger](../duration-ledger/README.md). The welcome allowance, lifecycle transitions, and writer reconciliation stay together here because they enforce account invariants. See [account deletion](../../docs/architecture/account-deletion.md) for the cross-object protocol.

## Database migrations

| Store   | Schema                                                 | Migrations                             |
| ------- | ------------------------------------------------------ | -------------------------------------- |
| Account | [Account schema](src/storage/account-sqlite-schema.ts) | [Account migrations](drizzle/account/) |

The account database includes the [rate-limit table](src/storage/rate-limit-schema.ts) from the [rolling limits library](../rolling-limits/README.md). Each Durable Object blocks incoming work until its generated Drizzle migrations finish. Account databases use a fresh baseline; production grant and registry storage retain their own legacy transitions.

After editing a schema, generate migrations from the repository root:

```sh
pnpm --filter @cup/accounts migrations:generate --name describe_change
pnpm --filter @cup/accounts test
pnpm validate:fast
```

Review generated SQL, snapshots, journals, and Worker bundles together. Add migrations after a baseline is deployed instead of rewriting applied history. Drizzle Kit cannot rename tables or columns non-interactively and does not carry data through rebuilt tables; for such a change, pass `--custom` to the generator, write SQL that moves the existing rows, and test it against data written by the previous migrations. The generator records the current schema as the custom migration's snapshot. Foreign keys stay enforced inside the migration transaction, so rebuilding a referenced table means rebuilding the tables that reference it too, as the [ledger alignment](drizzle/account/0005_align_duration_ledger_schema.sql) does. When Drizzle Kit rebuilds a table to add a constrained column, it also copies the new column from the old table, which lacks it; list only the existing columns in the copy, as the [usage confirmation](drizzle/account/0006_registry_usage_projection.sql) does. Tests verify schema-to-snapshot and bundle-to-SQL agreement while registry integration tests cover account accounting, dispatch, deletion, fencing, and shared ownership.

### Renumber a migration after a rebase

Drizzle numbers migrations sequentially, so two branches that each add a migration conflict on the same number. Keep the default branch's migrations and give the rebased branch's migration the next free number. Migration tests find migrations by tag name and derive counts from the generated migrations, so they need no edits after renumbering. The steps use `@cup/accounts`; substitute the package of the affected store.

1. While resolving the conflict, keep the default branch's version of the journal (`drizzle/<store>/meta/_journal.json`), the snapshots, and the Worker bundle under `src/migrations/`.
2. Save any hand-written SQL from the branch's migration file, then delete that file.
3. Generate the migration again under the next free number. For a hand-written migration, pass `--custom`:

   ```sh
   pnpm --filter @cup/accounts migrations:generate --custom --name describe_change
   ```

   For a generated migration, omit `--custom`; Drizzle Kit regenerates its SQL from the schema.

4. For a hand-written migration, copy the saved SQL into the new file, then rerun the generator to rebuild the Worker bundle from the SQL files. It should report no schema changes:

   ```sh
   pnpm --filter @cup/accounts migrations:generate
   ```

5. Check that the journal has no entry for the old number and that the new snapshot's `prevId` matches the previous snapshot's `id`.
6. Update links to the migration's SQL file, such as those in this README, and run the validation commands above.
