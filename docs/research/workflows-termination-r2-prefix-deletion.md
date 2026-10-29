# Workflows termination and R2 prefix deletion

> Historical research, incorporated 2026-10-29. Adopted as [ADR 0015](../adr/0015-fence-conversion-deletion-with-a-durable-marker-on-the-account-conversion-row.md), built in [#138](https://github.com/patricktree/cup/pull/138); see [Conversion deletion](../architecture/conversion-deletion.md). Cup differs from the recommendations below: it attempts termination once per instance and only logs any failure, whatever the instance status, instead of treating "cannot terminate" as success separately; it does not `delete()` the terminated instances, so their stored step state lives out its retention; and cleanup runs from the account alarm, which removes the registry ownership entry and the rows only after the prefix sweep finds nothing. Repository observations below describe `7ecc08d`.

[Original investigation](https://github.com/patricktree/cup/blob/745d0a571174c79578b644da4f0e952c3bdd9a63/docs/research/workflows-termination-r2-prefix-deletion.md).

Research date: 2026-10-28. Question from [issue 111](https://github.com/patricktree/cup/issues/111), part of the [conversion deletion map](https://github.com/patricktree/cup/issues/110).

Sources are Cloudflare's documentation pages, read as Markdown on 2026-10-28 (each page's `dateModified` is noted), and the local Workflows engine in [`cloudflare/workers-sdk`](https://github.com/cloudflare/workers-sdk/tree/fc57bc0e03b096cff58e949e67ccfb9f7832a3c2/packages/workflows-shared/src) at commit `fc57bc0e` (2026-10-28). The production Workflows engine is not open source; the local engine is Cloudflare's own emulation used by `wrangler dev` and Miniflare, so it shows intended semantics but does not prove production behavior. Statements marked as inference are not stated by any source.

## Summary

- `terminate()` is documented only as a lifecycle transition. No Cloudflare source says what happens to a `step.do` callback that is executing at that moment, so terminating cannot be treated as proof that the step's side effects will not land.
- `terminate()` throws for `complete`, `errored`, and `terminated` instances and is accepted otherwise, including `queued` (since 2024-12-19), `waiting`, and `paused`.
- A terminated instance keeps its ID until its retention expires or `delete()` removes it; `create()` with that ID throws until then. `restart()` is not documented as rejected for a terminated instance and the local engine has no status guard, so a terminated instance is not a permanent fence: Cup's own dispatch code restarts terminated segment instances today.
- R2 has no prefix delete in the Workers binding. Deleting a prefix means paging `list({ prefix, cursor })` (at most 1,000 keys per page, possibly fewer) and calling `delete(keys)` with at most 1,000 keys per call. Listing and deletion are strongly consistent, but only per operation.
- R2 documents that a `PUT` still in flight can commit after a later read returned "does not exist"; reads neither wait for nor cancel earlier writes. Conditional writes are atomic per key only, and there is no prefix-level lock. An `If-None-Match: *` write in flight can therefore create an object under a prefix that was already listed and deleted.

## Workflows termination

### What terminate does

The Workers API reference declares `terminate(options?: WorkflowInstanceTerminateOptions): Promise<void>` with the comment "If it is errored, terminated or complete, an error will be thrown", and an optional `rollback: true` that runs registered rollback handlers before the instance reaches `terminated` ([Workers API, terminate](https://developers.cloudflare.com/workflows/build/workers-api/#terminate), `dateModified` 2026-10-27). The trigger guide adds that "once stopped/terminated, the Workflow instance cannot be resumed" ([Trigger Workflows, stop a Workflow](https://developers.cloudflare.com/workflows/build/trigger-workflows/#stop-a-workflow), `dateModified` 2026-10-15). The `InstanceStatus` type describes `terminated` as "user terminated the instance while it was running" ([InstanceStatus](https://developers.cloudflare.com/workflows/build/workers-api/#instancestatus)).

Neither page says whether a `step.do` callback that is running when `terminate()` is called is interrupted, allowed to finish, or has its result discarded. By contrast, the trigger guide states for `restart()` that it "will immediately cancel any in-progress steps", and for `delete()` that "deleting a running instance stops its current execution without running rollback handlers" ([Trigger Workflows, restart and delete](https://developers.cloudflare.com/workflows/build/trigger-workflows/#restart-a-workflow)). No equivalent sentence exists for `terminate()`; a web search on 2026-10-28 found no first-party statement either.

The local engine terminates by writing a `WORKFLOW_TERMINATED` log entry, setting the status to `terminated`, and then aborting the engine's Durable Object, which aborts its `AbortController` and calls `ctx.abort()` ([`engine.ts` lines 1222–1230 and 1431–1471](https://github.com/cloudflare/workers-sdk/blob/fc57bc0e03b096cff58e949e67ccfb9f7832a3c2/packages/workflows-shared/src/engine.ts#L1431-L1471)). The user's `run()` executes in the Workflow's Worker, invoked over RPC from the engine (`USER_WORKFLOW.run`). Aborting the engine ends that RPC from the engine's side.

Inference: a subrequest that a step already sent, such as an R2 `put()` whose request reached R2, is not recalled by aborting the caller. The R2 consistency page states the general rule that an in-flight write may still commit (see [in-flight writes](#in-flight-conditional-writes-and-the-missing-prefix-lock)). Whether code after the next `await` in the step still runs in production is undocumented. A design must therefore assume that a step running at termination can still produce at least the side effect it had already started.

The [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) (`dateModified` 2026-10-15) already require steps to be idempotent because a step "might be retried multiple times", and warn that "the engine may restart, and it will start over from the beginning of that step". A step can thus run more than once, and its side effects can occur in an attempt whose result is never recorded.

### Which statuses accept terminate

| Status at call time                              | Documented behavior                                                                                                                                                                    | Local engine (`changeInstanceStatus`) |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `queued`                                         | Accepted since the [2024-12-19 changelog](https://developers.cloudflare.com/workflows/reference/changelog/): "Workflows can now be terminated and pause instances from a queued state" | Accepted                              |
| `running`                                        | Accepted; mid-step effect undocumented (see above)                                                                                                                                     | Accepted; engine aborted              |
| `waiting` (sleep, retry backoff, `waitForEvent`) | Not singled out; not in the rejected list                                                                                                                                              | Accepted                              |
| `paused`, `waitingForPause`                      | Not singled out; not in the rejected list                                                                                                                                              | Accepted                              |
| `complete`, `errored`, `terminated`              | Throws ("If it is errored, terminated or complete, an error will be thrown")                                                                                                           | Throws `instance.cannot_terminate`    |
| Instance never created or already deleted        | `get()` of an unknown ID fails                                                                                                                                                         | `instance.not_found`                  |

The local engine's guard is in [`engine.ts` lines 1372–1386](https://github.com/cloudflare/workers-sdk/blob/fc57bc0e03b096cff58e949e67ccfb9f7832a3c2/packages/workflows-shared/src/engine.ts#L1372-L1386). Terminating an already finished instance is an error, not a no-op, so a deletion path must treat "cannot terminate, already finished" as success and still clean up what the finished instance wrote.

Inference: because `terminate()` rejects `errored` instances, an instance that is `errored` when the deletion runs stays restartable, and Cup's alarm restarts errored segment instances. Termination therefore does not cover instances that are momentarily `errored`; only a status-independent fence does.

### Reusing a terminated instance's ID

`create()` "throws an error if the provided ID is already used by an existing instance that has not yet passed its retention limit. To re-run a workflow with the same ID, you can `restart` the existing instance" ([Workers API, create](https://developers.cloudflare.com/workflows/build/workers-api/#create)). `createBatch` reports the same case as error code `10405`, "An instance with this ID already exists". Retention for terminated instances is `success_retention`, which applies "to instances that complete successfully and to instances that are terminated"; without configuration it is the account maximum, 30 days on Workers Paid and 3 days on Workers Free ([default instance retention](https://developers.cloudflare.com/workflows/build/workers-api/#default-instance-retention); [limits](https://developers.cloudflare.com/workflows/reference/limits/), `dateModified` 2026-09-21).

`delete()` removes "the instance and its stored state"; `deleteBatch()` removes up to 100 IDs per call ([Trigger Workflows, delete instances](https://developers.cloudflare.com/workflows/build/trigger-workflows/#delete-workflow-instances)). The docs do not state that a deleted ID can be created again, but the uniqueness rule is phrased in terms of an "existing instance", and the local binding explicitly serializes storage cleanup "with reuse of the same ID" and checks for an existing engine before `create()` ([`binding.ts` lines 116 and 419–447](https://github.com/cloudflare/workers-sdk/blob/fc57bc0e03b096cff58e949e67ccfb9f7832a3c2/packages/workflows-shared/src/binding.ts#L419-L447)). Inference: after `delete()`, or after retention expires, `create()` with the same ID succeeds and starts a fresh instance.

### Restart after terminate

The docs say a terminated instance "cannot be resumed", but do not say whether `restart()` is rejected for it. The local engine's `restart` path has no status check: it aborts the engine, wipes run state, and calls `init()` again ([`engine.ts` lines 1536–1587](https://github.com/cloudflare/workers-sdk/blob/fc57bc0e03b096cff58e949e67ccfb9f7832a3c2/packages/workflows-shared/src/engine.ts#L1536-L1587)). Cup already relies on restarting terminated instances: [`dispatchSegmentWorkflow`](../../libs/conversion-contracts/src/index.ts) restarts a segment instance whose status is `errored` or `terminated` when `create()` fails. Each restart counts against the instance creation rate ([limits, footnote 6](https://developers.cloudflare.com/workflows/reference/limits/)).

## R2 prefix deletion

### Listing and deleting

From the [R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) (`dateModified` 2026-07-31):

- `delete(key: string | string[])` deletes "up to 1000 keys" per call and is strongly consistent once its promise resolves. There is no prefix or wildcard form.
- `list(options)` returns objects in lexicographic order, "up to 1000 entries, but may return less in order to minimize memory pressure"; `limit` defaults to and is capped at 1,000. Callers must loop on `truncated` and pass `cursor`, not compare the count against `limit`; with `include` metadata, fewer results come back per page.
- `put()` with a failed precondition returns `null` and stores nothing.

The [consistency model](https://developers.cloudflare.com/r2/reference/consistency/) (`dateModified` 2026-10-14) states that deletion is strongly consistent and that listing "will list all objects at that point in time". It also states that when two clients write (`PUT` or `DELETE`) the same key, "the last writer to complete wins".

Inference: each list page is a point-in-time view, but a paged walk is not a snapshot of the whole prefix. An object written behind the cursor after its page was returned is not listed by that walk.

Object lifecycle rules can expire objects by prefix, but removal "typically" happens "within 24 hours" of expiry ([object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), `dateModified` 2026-10-26), so they are not an immediate prefix delete.

### In-flight conditional writes and the missing prefix lock

The consistency page documents conditional writes as atomic per key: the condition "is always evaluated against the committed state of the bucket at the moment the write commits", and competing `If-None-Match: *` writes to an absent key let at most one succeed.

The same page has a section on negative reads and in-flight writes: a 404 "tells you that the object did not exist at the moment the read was processed", and "a request that was still in flight … may still commit after the negative read has returned. Reads are never stale, but they do not wait for or cancel earlier writes."

Taken together, and with no prefix-level lock, bucket-level transaction, or "deny writes under prefix" operation anywhere in the Workers binding: a `put(key, body, { onlyIf: If-None-Match: * })` that was sent before a deletion listed the prefix, or that is sent after the deletion deleted `key`, evaluates its condition against the key's state at commit time. That key is absent after the delete, so the write succeeds and recreates an object under a prefix that the deletion already emptied. `If-None-Match: *` prevents overwriting an existing object; it does not prevent recreating a deleted one.

## Implications for a per-conversion deletion fence

These are recommendations derived from the facts above, not facts.

- Neither primitive is a fence. Termination does not stop a write already handed to R2, does not apply to finished or `errored` instances, and can be undone by `restart()`; R2 deletion does not prevent later writes. The fence must live in application state that every effect consults, which in Cup means the owning Durable Object.
- The account's [artifact writer](../../libs/accounts/src/artifacts/artifact-writer.ts) already has the needed shape for account erasure: it registers each write with the account before handing it to R2 and acknowledges and drains it afterward. A conversion-level fence can follow the same order: mark the conversion deleted in the account object so that new `prepareArtifactWrite` calls and phase or settlement records for it are rejected, wait until its registered writers have drained or been reconciled, then list and delete the prefix. Writes that were registered before the mark can then be accounted for, and writes after it never reach R2.
- Order matters: fence first, then terminate, then delete. Terminating before the fence leaves a window in which the alarm's [segment reconciliation](../../libs/conversion-contracts/src/index.ts) or a dispatch can re-create or restart an instance.
- The reconciliation and dispatch code must treat a deleted conversion as "do not create or restart", independently of the instance status, because `create()` succeeds again for a deleted or expired instance ID and `restart()` revives a terminated one.
- Treat `terminate()` rejecting a finished instance as success, and optionally `delete()` the instances afterwards so that their stored state, which holds step results such as narration text, does not outlive the conversion for the retention period.
- Repeat the prefix walk until a pass finds nothing, after drained writers are confirmed, rather than trusting a single paged walk, since writes behind the cursor are not observed.
