# Duration ledger

This library stores one owner's [duration ledger](../../docs/GLOSSARY.md#duration-ledger): its duration allowance, duration reservations, and the generated audio duration they settle into. Accounts and conversion grants use the same tables and the same [ledger](src/duration-ledger.ts); each owner's Durable Object keeps its own copy in its SQLite database.

The [schema](src/duration-ledger-schema.ts) defines the append-only ledger, its cached balances, which `inspectAccounting` verifies against the events, and the owner's `audio_segments` table, which references the owner's conversion table.

An owner's allowance is the sum of its grant and adjustment events, and its spent duration is the sum of its consume events. Because events are only appended, their count is a revision that advances with every change; accounts use it to order the usage projections they push to the registry. A settled segment is charged at most the allowance that is not yet spent, so overruns never spend more than the allowance. Owner-specific rules stay with the owner: accounts issue a welcome allowance and signed operator adjustments, while a conversion grant records an operator's new total as the adjustment from its previous total and refuses new reservations once it has expired or been revoked.

Owner schemas re-export the ledger tables, so each owner's migrations create them. See the [database diagrams](../../docs/architecture/durable-object-storage.md) and the migration guides for [accounts](../accounts/README.md#database-migrations) and [conversion grants](../conversion-grants/README.md).
