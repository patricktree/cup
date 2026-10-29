# Conversion deletion

[Conversion deletion](../GLOSSARY.md#conversion-deletion) removes one account conversion for good while the rest of the account keeps working. [ADR 0015](../adr/0015-fence-conversion-deletion-with-a-durable-marker-on-the-account-conversion-row.md) records why it is fenced by a durable marker; this page states the invariants that no single file shows.

## Invariants

- **The marker is both the fence and the record of owed cleanup.** Once the deletion marker is set on the account conversion row, every gate of the account object treats the conversion like a missing one: no execution, settlement, artifact writer, dispatch or read gets through. The same marker records that cleanup is still owed. The listener sees the conversion as unknown (404) from that moment, with no tombstone.
- **Marking releases open holds and keeps settled charges.** The marker and the release of every still-reserved reservation commit in one transaction, so no hold outlives the marker and spent duration stays spent.
- **Workflow termination is never relied on.** Deletion tries once to terminate the conversion's preparation and segment workflows, to save cost. Whatever keeps running fails its next authorization check.
- **A repeat is a no-op.** Deleting a marked conversion again releases nothing and terminates nothing.

Planned with the alarm-driven cleanup ([patricktree/cup#132](https://github.com/patricktree/cup/issues/132)), not yet built: until it lands, a marked conversion keeps its R2 objects, writer rows, registry ownership entry and rows.

- **Writers drain before the sweep.** The conversion's artifact writers drain, as in [account erasure](account-deletion.md#fencing-and-cleanup), before its R2 prefix is swept; a writer that never resolves stalls only this conversion's cleanup.
- **The marked row goes last.** Cleanup removes the conversion's records with the marked row last, so a crash between steps resumes on the next alarm.
- **Account erasure subsumes it.** Erasing the account sweeps the whole account, so a conversion deletion still in progress needs no handoff.

## Where it lives

- The listener route `DELETE /api/account/conversions/{conversionId}` in the [listener contracts](../../libs/listener-api.routes/src/hono-app.ts) and its [handler](../../libs/api-server/src/api-server.ts) act on the caller's own account only and require an `active` account; a trial conversion is not found.
- The operator route `DELETE /api/operator/conversions/{conversionId}` in the [operator contracts](../../libs/operator-api.routes/src/hono-app.ts) and its [handler](../../libs/api-server/src/api-server.ts) resolve the owner through the registry: an unknown conversion is `conversion-not-found`, a trial one `conversion-not-account-owned`, and a `deleting` account `account-unavailable`. Its 204 names the owning account in the `X-Account-Id` header, because the [operator CLI](../../apps/operator/README.md#delete-a-conversion) prints it. Operator account inspection lists the marked conversions with their `deleting_since_ms`.
- The [account object](../../libs/accounts/src/durable-object/account-durable-object.ts)'s `deleteConversion` also accepts a `deletion_scheduled` account and refuses a `deleting` one; the [account storage](../../libs/accounts/src/storage/account-sqlite.ts) marks and releases, and the [writer ledger](../../libs/accounts/src/storage/account-artifact-writers.ts) refuses new writers.
- Tests: the registry's [`accounts.test.ts`](../../libs/registry/test/accounts.test.ts) covers the fence, the release and repeats against real objects, and [`delete-account-conversion.test.ts`](../../libs/api-server/test/delete-account-conversion.test.ts) and [`operator-access.test.ts`](../../libs/api-server/test/operator-access.test.ts) the HTTP mappings.
