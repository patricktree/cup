---
status: accepted
---

# Fence conversion deletion with a durable marker on the account conversion row

[Conversion deletion](../GLOSSARY.md#conversion-deletion) has to stop everything still running for one conversion while the rest of the account keeps working, and it must not refund spent duration. Neither Cloudflare primitive involved fences anything: a terminated workflow may still land a running step's side effects and can be restarted, and R2 has no prefix delete or prefix lock, so an in-flight conditional write can recreate an object after its prefix was swept ([patricktree/cup#111](https://github.com/patricktree/cup/issues/111), [research](../research/workflows-termination-r2-prefix-deletion.md)). The account [execution epoch](../GLOSSARY.md#execution-epoch) fences a whole account, not one conversion. The map [patricktree/cup#110](https://github.com/patricktree/cup/issues/110) decided the approach on 2026-10-28 in [patricktree/cup#112](https://github.com/patricktree/cup/issues/112) (fence and reservations), [patricktree/cup#113](https://github.com/patricktree/cup/issues/113) (lifecycle), [patricktree/cup#122](https://github.com/patricktree/cup/issues/122) (listener API) and [patricktree/cup#124](https://github.com/patricktree/cup/issues/124) (documentation); the spec is [patricktree/cup#132](https://github.com/patricktree/cup/issues/132). [patricktree/cup#133](https://github.com/patricktree/cup/issues/133) implemented the fence, the release and the listener route, merged in [patricktree/cup#138](https://github.com/patricktree/cup/pull/138) (commit `b0c9ea4`).

## Decision

- **A durable marker is the fence.** A nullable column on the account conversion row records when deletion was requested. The account's existing gates treat a marked row exactly like a missing one: execution checks, settlement, the artifact-writer target check and dispatch reconciliation refuse it, and every read reports the conversion as unknown. The marker is not a conversion status and the listener API never exposes it.
- **The marker also records the owed cleanup.** It stays set until cleanup removes the row, last of all the conversion's records.
- **One synchronous call marks and releases.** The account object's deletion method sets the marker and releases every still-reserved duration reservation of the conversion in one transaction. Settled segments stay charged, so spent duration stays spent.
- **Termination is best effort.** After that commit the method tries once to terminate the preparation instance and each segment instance; a failed termination is neither retried nor recorded.
- **No per-conversion epoch.** The account execution epoch stays the only epoch.

## Considered options

- **Rely on workflow termination.** Rejected: termination does not stop a running step's side effects, and a terminated instance can be restarted.
- **A per-conversion execution epoch.** Rejected: every workflow parameter, writer registration and gate would carry a second epoch, while the marker reuses the existing "missing row" path of each gate.
- **Leave open reservations to settle.** Rejected: a late settlement would charge audio that never became accessible, against [ADR 0003](0003-charge-for-accessible-generated-narration.md), and a hold whose segment rows were removed would stay in the ledger forever.

## Consequences

- Workflows that outlive their termination fail their next authorization check, and their writes are fenced at writer registration.
- Audio that reached R2 but was never settled is released, not charged; Cup absorbs its cost.
- Deletion refunds nothing beyond releasing open holds, which follows from ADR 0003 and the [account conversion allowance](../GLOSSARY.md#account-conversion-allowance).
- Cleanup of the conversion's writers, R2 prefix, registry ownership entry and rows runs only from the account alarm (decided in patricktree/cup#113, implemented in [patricktree/cup#134](https://github.com/patricktree/cup/issues/134), merged in [patricktree/cup#138](https://github.com/patricktree/cup/pull/138), commit `b0c9ea4`); [conversion deletion](../architecture/conversion-deletion.md) states its invariants.
- As of commit `b0c9ea4`, [`accounts.test.ts`](../../libs/registry/test/accounts.test.ts) covers the fence, the release and repeats, and [`delete-account-conversion.test.ts`](../../libs/api-server/test/delete-account-conversion.test.ts) covers the listener route.
