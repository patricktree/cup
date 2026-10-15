# Duration ledger

This library stores one owner's duration allowance, duration reservations, and charges for generated audio duration. Accounts and conversion grants use the same tables and the same [ledger](src/duration-ledger.ts); each owner's Durable Object keeps its own copy in its SQLite database.

The [schema](src/duration-ledger-schema.ts) defines three ledger tables and the owner's `audio_segments` table:

- `credit_operations` records each allowance grant, adjustment, and segment reservation once.
- `credit_ledger` appends `grant`, `adjustment`, `reserve`, `consume`, and `release` events with their effect on available and reserved duration.
- `credit_balances` caches the sums of those effects; `inspectAccounting` verifies that they match.
- `audio_segments` records each audio segment's estimate, state, actual and charged duration, and the reservation operation behind it. Owners pass their conversion table so that segments reference it.

An owner's allowance is the sum of its grant and adjustment events, and its spent duration is the sum of its consume events. A settled segment is charged at most the allowance that is not yet spent, so overruns never spend more than the allowance. Owner-specific rules stay with the owner: accounts issue a welcome allowance and signed operator adjustments, while a conversion grant records an operator's new total as the adjustment from its previous total and refuses new reservations once it has expired or been revoked.

Owner schemas re-export the ledger tables, so each owner's migrations create them. See the [database diagrams](../../docs/architecture/durable-object-storage.md) and the migration guides for [accounts](../accounts/README.md#database-migrations) and [conversion grants](../conversion-grants/README.md).
