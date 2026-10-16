---
status: accepted
---

# Keep requests strict and response parsing tolerant

API contracts are zod schemas in the [listener contracts](../../libs/listener-api.routes/src/contracts.ts) and [operator contracts](../../libs/operator-api.routes/src/contracts.ts) (see [API definitions](../architecture/README.md#api-definitions)). Most of their objects call `.strict()`, which rejects unknown keys, and they used it for requests and responses alike. The operator contracts also copied account shapes by hand instead of importing them from `@cup/accounts/contracts`. The [server composition](../../libs/api-server/src/api-server.ts) parsed some of its own responses with these schemas before sending them. When a schema had drifted from the data, the handler threw and `app.onError` answered with a generic `operational-error` 500, which until 6bd8708 it did not log.

After the 2026-10-16 production deploy, `pnpm operator account inspect` failed three times in a row, each time because the operator response schema had drifted from what `@cup/accounts` returns:

| Commit  | Drift                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 38f8342 | Account history added an optional `hasCoverImage` field to ready outcomes; the strict operator outcome schema rejected the unknown key.                           |
| 6bd8708 | Account history reports derived conversion statuses (`synthesizing`, `insufficient-duration`); the operator schema allowed only `pending`, `ready`, and `failed`. |
| 1d75504 | `inspectAccounting` returned the ledger `balance` without its `unit`; the operator schema required it.                                                            |

Each fix was a one-line schema or data change, but each failure surfaced only in production, as an unlogged 500, one at a time. The type checker caught none of them: `.parse` accepts any input, so the handler's value was never compared with the schema's type. Strict response parsing also does not suit the listener API: installed Android apps keep running older client code against the newest Worker, so a strict client schema turns every added response field into an outage for users who have not updated. On 2026-10-16 the user decided the following rules.

## Decision

1. **Requests stay strict.** Schemas for client input that the server validates, such as bodies, parameters, and queries, keep `.strict()`. Unknown input is a client bug or an attack, and rejecting it with a 400 is the useful answer.
2. **Clients tolerate unknown response keys.** Code that parses a response uses the default `z.object`, which accepts unknown keys and drops them. A newer server may add fields that an older client does not know.
3. **The server does not check its own responses at runtime.** Handlers type their response values against the contract with `satisfies` and send them without parsing. Tests parse responses strictly, so drift fails in CI instead of in production.
4. **Contracts derive shared shapes from the owning package.** A contract that exposes another package's data imports that package's schema, for example from `@cup/accounts/contracts`, and composes it with `.extend`, `.pick`, or similar, instead of copying the shape.

## Considered options

- Keep strict responses and runtime parsing, and fix drift as it appears. Rejected: this is the state that failed three times, and every installed app version would also break on additive server changes.
- Make every schema tolerant, including requests. Rejected: the server would silently ignore misspelled or unsupported input.
- Keep runtime response parsing on the server, but with tolerant schemas. Rejected: it still turns missing or changed fields into 500s in production, and once shapes are derived from the owning package the compile-time check covers the same ground.

## Consequences

- Reviewers should flag: `.strict()` on a schema a client uses to parse a response; `.parse` or `.safeParse` of a handler's own response in server code; a contract shape that repeats another package's schema instead of importing it; and a response change that is not covered by a strict test.
- Rules 2 and 3 pull in opposite directions for shared schemas: a contract response schema that clients parse is tolerant, yet tests must check responses strictly. How tests obtain a strict check without a second hand-written schema is left to the implementation. Likewise, an owning package's schema may itself be strict, such as `accountOutcomeSchema`; a response shape derived from it under rule 4 must not carry that strictness to clients.
- Tolerance covers added fields only. Removing, renaming, or narrowing a response field still breaks installed apps, so such changes need the same care as before.
- Contract packages depend on the owning packages' contract entry points, such as `@cup/accounts/contracts`, not on their main entry points, so clients that import a contract do not pull in Worker code.

### Implementation status

This decision is accepted, and its implementation is in progress in parallel pull requests. On 2026-10-16, the following code did not follow it yet:

- The [server composition](../../libs/api-server/src/api-server.ts) parses its own responses with `audiobookSchema`, `listAccountDeletionsResponseSchema`, and `inspectAccountResponseSchema` (rule 3).
- The operator contracts define `accountConversionOutcomeSchema` and the account inspection shapes by hand, duplicating `accountOutcomeSchema` from [`@cup/accounts/contracts`](../../libs/accounts/src/account-contracts.ts) (rule 4). The listener contracts' `historyItemSchema` also repeats the account outcome shape.
- Many response schemas in the listener, operator, and [grant](../../libs/conversion-grants/src/grant-contracts.ts) contracts call `.strict()`, and the web app parses responses with them, for example `audiobookSchema` and `retryConversionResponseSchema` in the [reader](../../apps/web-app/src/data-fetching/reader.ts) and `grantSnapshotSchema` and `startConversionResponseSchema` in [trial conversion](../../apps/web-app/src/data-fetching/conversion-grant.ts) (rule 2). [Account history](../../apps/web-app/src/data-fetching/account-history.ts) already parses tolerant schemas.
