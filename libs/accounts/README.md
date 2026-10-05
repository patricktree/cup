# Accounts

This library owns private account conversion history, duration accounting, lifecycle transitions, and artifact-write fencing. `AccountDurableObject` keeps its existing class name and binding. The [shared registry](../registry/README.md) owns account identity mapping, provisioning, and deletion coordination.

`AccountDurableObject` requires the `PREPARE_AUDIOBOOK_WORKFLOW` binding for preparation dispatch and retries, and the `SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW` binding for player-requested speech synthesis. The required `REGISTRY` binding uses a [narrow registry RPC interface](src/account-registry.ts) for conversion ownership and deletion intent; the required `AUDIO_BUCKET` binding supports artifact reconciliation and account erasure. Integration tests in [registry](../registry/README.md) exercise account behavior against the real registry and trial grant objects.

Shared conversion schemas and duration calculations live in [conversion-contracts](../conversion-contracts/README.md). Account ledgers, lifecycle transitions, and writer reconciliation stay together here because they enforce account invariants. See [account deletion](../../docs/architecture/account-deletion.md) for the cross-object protocol.

## Database migrations

| Store   | Schema                                         | Migrations                             |
| ------- | ---------------------------------------------- | -------------------------------------- |
| Account | [Account schema](src/account-sqlite-schema.ts) | [Account migrations](drizzle/account/) |

The account database includes the [rate-limit table](src/sqlite-schema-shared.ts). Each Durable Object blocks incoming work until its generated Drizzle migrations finish. Moving these files into this library does not change SQL, migration journals, or storage ownership. Account databases use a fresh baseline; production grant and registry storage retain their own legacy transitions.

After editing a schema, generate migrations from the repository root:

```sh
pnpm --filter @cup/accounts migrations:generate --name describe_change
pnpm --filter @cup/accounts test
pnpm validate:fast
```

Review generated SQL, snapshots, journals, and Worker bundles together. Add migrations after a baseline is deployed instead of rewriting applied history. Tests verify schema-to-snapshot and bundle-to-SQL agreement while registry integration tests cover account accounting, dispatch, deletion, fencing, and shared ownership.
