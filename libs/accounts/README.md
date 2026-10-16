# Accounts

This library owns private account conversion history, duration accounting, lifecycle transitions, and artifact-write fencing. `AccountDurableObject` keeps its existing class name and binding. The [shared registry](../registry/README.md) owns account identity mapping, provisioning, and deletion coordination.

`AccountDurableObject` requires the `PREPARE_AUDIOBOOK_WORKFLOW` binding for preparation dispatch and retries, and the `SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW` binding for player-requested speech synthesis. The required `REGISTRY` binding uses a [narrow registry RPC interface](src/account-registry.ts) for conversion ownership, usage projection, and deletion intent; the required `AUDIO_BUCKET` binding supports artifact reconciliation and account erasure. Integration tests in [registry](../registry/README.md) exercise account behavior against the real registry and trial grant objects.

Shared conversion schemas and duration calculations live in [conversion-contracts](../conversion-contracts/README.md), and the duration ledger shared with conversion grants lives in [duration-ledger](../duration-ledger/README.md). The welcome allowance, lifecycle transitions, and writer reconciliation stay together here because they enforce account invariants. See [account deletion](../../docs/architecture/account-deletion.md) for the cross-object protocol.

## Database migrations

| Store   | Schema                                         | Migrations                             |
| ------- | ---------------------------------------------- | -------------------------------------- |
| Account | [Account schema](src/account-sqlite-schema.ts) | [Account migrations](drizzle/account/) |

The account database includes the [rate-limit table](src/rate-limit-schema.ts) from the [rolling limits library](../rolling-limits/README.md). Each Durable Object blocks incoming work until its generated Drizzle migrations finish. Account databases use a fresh baseline; production grant and registry storage retain their own legacy transitions.

After editing a schema, generate migrations from the repository root:

```sh
pnpm --filter @cup/accounts migrations:generate --name describe_change
pnpm --filter @cup/accounts test
pnpm validate:fast
```

Review generated SQL, snapshots, journals, and Worker bundles together. Add migrations after a baseline is deployed instead of rewriting applied history. Drizzle Kit cannot rename tables or columns non-interactively and does not carry data through rebuilt tables; for such a change, pass `--custom` to the generator, write SQL that moves the existing rows, and test it against data written by the previous migrations. The generator records the current schema as the custom migration's snapshot. Foreign keys stay enforced inside the migration transaction, so rebuilding a referenced table means rebuilding the tables that reference it too, as the [ledger alignment](drizzle/account/0005_align_duration_ledger_schema.sql) does. When Drizzle Kit rebuilds a table to add a constrained column, it also copies the new column from the old table, which lacks it; list only the existing columns in the copy, as the [usage confirmation](drizzle/account/0006_registry_usage_projection.sql) does. Tests verify schema-to-snapshot and bundle-to-SQL agreement while registry integration tests cover account accounting, dispatch, deletion, fencing, and shared ownership.
