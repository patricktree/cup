# Rolling limits

This library enforces rolling-window rate limits inside a Durable Object's SQLite database. Accounts, conversion grants, and the registry each keep their own `rate_events` table from the [shared schema](src/rate-limit-schema.ts) and enforce their limits through the same [limiter](src/rolling-limits.ts), which prunes expired rows in SQL. Each store separates its limits by bucket name.

Owner schemas re-export `rateEvents`, so each owner's migrations create the table. See the [database diagrams](../../docs/architecture/durable-object-storage.md).
