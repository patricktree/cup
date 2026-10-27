# Account deletion and recovery

[Account deletion](../GLOSSARY.md#account-deletion) is the full lifecycle spanning account state, conversion execution, object storage, Supabase identity, and notifications. [Account erasure](../GLOSSARY.md#account-erasure) is its internal step for removing Cup-owned content and records. User-facing copy uses account deletion. Scheduling blocks ordinary access immediately and allows explicitly confirmed recovery for seven days. The registry coordinates durable cleanup independently of the account being erased.

```mermaid
flowchart TD
    Scheduled[Deletion scheduled: ordinary access blocked]
    Scheduled -->|Explicit recovery before deadline|Active[Active: history and allowance preserved]
    Scheduled -->|Deadline reached|Fenced[Account execution and identity mapping fenced]
    Fenced --> Identity[Delete exact old Supabase identity]
    Fenced --> Storage[Drain writers and erase account-owned data]
    Identity --> Complete[After both succeed: remove identity mapping]
    Storage --> Complete
    Complete --> Notice[Queue completion notice]
```

Identity deletion and Cup storage cleanup retry independently; an identity-provider outage does not prevent Cup cleanup. The diagram shows dependencies, not a distributed transaction.

## Confirmation and recovery

Deletion and recovery require a one-use challenge and fresh Google authentication for the same identity, as described in [authentication](authentication.md#operator-access-and-lifecycle-confirmation). Signing in alone does not restore access.

Lifecycle endpoints belong to the [listener API](README.md#api-definitions). A refused confirmation is an explicit conflict, while unexpected storage or registry failures remain operational errors. After scheduling, the API attempts Google token revocation when the client supplies a provider token, verifies that it belongs to the same identity, and records the outcome. Revocation failure does not undo scheduling; a failure to record the outcome is reported as an operational error, not a rejected confirmation.

Scheduling signs the requesting client out, which stops playback, and blocks subsequent private access checks. Lifecycle inspection and explicit recovery, after signing in again, remain available until the deadline. Recovery preserves history and allowance; once the deadline is reached, recovery is refused. The registry's [`accounts.test.ts`](../../libs/registry/test/accounts.test.ts) covers fresh authentication and recovery, and [`account-lifecycle-api.test.ts`](../../libs/api-server/test/account-lifecycle-api.test.ts) the API's origin checks and revocation outcomes.

Sources: [client confirmation](../../apps/web-app/src/data-fetching/account-confirmation.ts), [lifecycle API](../../libs/api-server/src/api-server.ts), and [atomic account transitions](../../libs/accounts/src/storage/account-lifecycle.ts).

## Fencing and cleanup

The account persists lifecycle changes and delivery intent together, then delivers that intent to the registry through a replayable outbox. At cleanup, changing the execution epoch prevents old workflow activity from writing. Registered artifact writers must drain and uncertain storage effects must be reconciled before erasure; a lost acknowledgement does not prove a writer stopped.

Account erasure removes the account's R2 prefix, conversion-owner routes, and account records, retaining a constant erasure marker to reject late execution. The registry deletes the exact old Supabase identity and removes its mapping only after both identity and account cleanup succeed. Original trial conversions and other accounts remain separate; the registry's `accounts.test.ts` checks that erasure waits for an in-flight upload and preserves both.

The coordinator awaits account and provider calls with its Durable Object input gate open, so a restore delivery or a Google revocation outcome can be accepted while it waits. It continues from the stored job after an awaited fence, and a failed attempt does not overwrite a restore accepted meanwhile ([`deletion-coordinator.test.ts`](../../libs/registry/test/deletion-coordinator.test.ts)).

Failures retain durable progress and retry with backoff. Operators can inspect overdue cleanup with the [operator CLI](../../apps/operator/README.md#list-account-deletions); there is no force-complete action that discards uncertain writers.

Sources: [account cleanup](../../libs/accounts/src/durable-object/account-durable-object.ts), [writer reconciliation](../../libs/accounts/src/storage/account-artifact-writers.ts), [registry alarms](../../libs/registry/src/durable-object/registry-durable-object.ts), [coordinator](../../libs/registry/src/account-deletion/deletion-coordinator.ts), and [Supabase identity deletion](../../libs/registry/src/providers/supabase-identity.ts).

## Notifications and retained evidence

Scheduled and completed notices have durable intent and distinct immutable idempotency keys. Retries stop before the provider deduplication window expires to avoid duplicate sends after ambiguous outcomes. Provider acceptance does not establish inbox delivery.

Terminal notification payloads are redacted. After cleanup and notification processing finish, receipts retain identifiers, timestamps, and outcomes for 90 days, excluding email, tokens, and provider response bodies. The account's erasure marker carries no deletion-attempt identifier. These application rules do not establish retention in external provider logs or backups.

Notices go to Resend. A permanent rejection is final; other failures, timeouts, and lost responses retry with backoff, no earlier than the provider asks. The [coordinator tests](../../libs/registry/test/deletion-coordinator.test.ts) assert exactly one email per notification key against the [Resend stub](../../qa/resend-stub/src/resend-stub.ts), including after ambiguous outcomes; the root [validation guide](../../AGENTS.md#validation) describes the stub and its opt-in live contract test.

Sources: [notification and receipt implementation](../../libs/registry/src/account-deletion/deletion-coordinator.ts) and the [Resend call](../../libs/registry/src/providers/resend-email.ts). See [production configuration](../production-configuration.md#email) for configuration and the [operator CLI](../../apps/operator/README.md#list-account-deletions) for inspection.

Related research: [provider deletion](../research/social-signup/account-deletion-research.md), [transactional email](../research/social-signup/transactional-email-research.md), and [telemetry retention](../research/social-signup/telemetry-retention-research.md).
