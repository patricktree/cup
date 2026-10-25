# Errors

Runtime-independent error helpers shared by the Worker, the API server, Durable Objects, and the conversion workflows.

- [`findRootCause` and `findRootCauseMessage`](src/root-cause.ts) return the innermost value of an error's `cause` chain. Server code that logs a caught error logs only this root cause plus the log line's own context, because wrapping errors such as Drizzle's query errors embed SQL parameters or request data. A cause chain that loops back on itself ends at the last error before the repetition.
- [`assertUnreachable`](src/assert-unreachable.ts) ends an exhaustive `switch` or if-chain over a union: a missed case fails to compile, and an unexpected runtime value throws with its JSON instead of taking a silent fallback. Keep a fallback that is the specified behavior, such as tolerating unknown values at the listener API under [ADR 0010](../../docs/adr/0010-tolerate-unknown-keys-at-the-listener-api.md).

This library has no runtime dependencies and imports no other Cup package, so every package can depend on it without creating a dependency cycle.
