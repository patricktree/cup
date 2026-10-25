---
status: accepted
---

# Tolerate unknown keys at the listener API, stay strict elsewhere

API contracts are zod schemas in the [listener contracts](../../libs/listener-api.routes/src/contracts.ts) and [operator contracts](../../libs/operator-api.routes/src/contracts.ts) (see [API definitions](../architecture/README.md#api-definitions)). Most of their objects call `.strict()`, which rejects unknown keys, and they used it for requests and responses alike. The operator contracts also copied account shapes by hand instead of importing them from `@cup/accounts/contracts`. The [server composition](../../libs/api-server/src/api-server.ts) parsed some of its own responses with these schemas before sending them. When a schema had drifted from the data, the handler threw and `app.onError` answered with a generic `operational-error` 500, which until 6bd8708 it did not log.

After the 2026-10-16 production deploy, `pnpm operator account inspect` failed three times in a row, each time because the operator response schema had drifted from what `@cup/accounts` returns:

| Commit  | Drift                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 38f8342 | Account history added an optional `hasCoverImage` field to ready outcomes; the strict operator outcome schema rejected the unknown key.                           |
| 6bd8708 | Account history reports derived conversion statuses (`synthesizing`, `insufficient-duration`); the operator schema allowed only `pending`, `ready`, and `failed`. |
| 1d75504 | `inspectAccounting` returned the ledger `balance` without its `unit`; the operator schema required it.                                                            |

Each fix was a one-line schema or data change, but each failure surfaced only in production, as an unlogged 500, one at a time. The type checker caught none of them: `.parse` accepts any input, so the handler's value was never compared with the schema's type. Strict response parsing also does not suit the listener API: installed Android apps keep running older client code against the newest Worker, so a strict client schema turns every added response field into an outage for users who have not updated. The same holds in the other direction: those apps keep sending request fields that the Worker may stop using, so a strict request schema turns the removal of a field into 400s for them. On 2026-10-16 the user decided the following rules.

## Decision

1. **Listener API requests drop unknown keys.** Listener request schemas, such as bodies, parameters, and queries, use the default `z.object`, never `.strict()` and never `.passthrough()`. Zod removes unknown keys before handlers see the data, so tolerance does not open a mass-assignment risk.
2. **Operator API requests and internal inputs stay strict.** Operator request schemas keep `.strict()`, because the operator CLI from this repository is the only client and always runs from a current checkout. Internal boundaries also stay strict: Durable Object RPC inputs, storage, and workflow parameters.
3. **Listener requests evolve compatibly.** A new listener request field is optional and has a server-side default, and a request enum is never narrowed. Either change would break installed apps regardless of strictness.
4. **Clients tolerate unknown response keys.** Code that parses a response uses the default `z.object`, which accepts unknown keys and drops them. A newer server may add fields that an older client does not know.
5. **The server does not check its own responses at runtime.** Handlers type their response values against the contract with `satisfies` and send them without parsing. Tests parse responses strictly, so drift fails in CI instead of in production.
6. **Contracts derive shared shapes from the owning package.** A contract that exposes another package's data imports that package's schema, for example from `@cup/accounts/contracts`, and composes it with `.extend`, `.pick`, or similar, instead of copying the shape.

## Considered options

- Keep all requests strict. Rejected: removing a listener request field would turn requests from installed apps into 400s.
- Make every schema tolerant, including operator and internal inputs. Rejected: those inputs have no outdated clients, so strictness there catches misspelled or unsupported input at no compatibility cost.
- Let listener requests pass unknown keys through with `.passthrough()`. Rejected: handlers would receive fields the contract does not declare, which risks mass assignment.
- Keep strict responses and runtime parsing, and fix drift as it appears. Rejected: this is the state that failed three times, and every installed app version would also break on additive server changes.
- Keep runtime response parsing on the server, but with tolerant schemas. Rejected: it still turns missing or changed fields into 500s in production, and once shapes are derived from the owning package the compile-time check covers the same ground.

## Consequences

- Reviewers should flag: `.strict()` or `.passthrough()` on a listener request schema; a missing `.strict()` on an operator request schema or an internal input; a new required listener request field, one without a server-side default, or a narrowed listener request enum; `.strict()` on a schema a client uses to parse a response; `.parse` or `.safeParse` of a handler's own response in server code; a contract shape that repeats another package's schema instead of importing it; and a response change that is not covered by a strict test.
- Accepted cost: a misspelled optional field in a listener request is silently ignored instead of rejected. The shared, typed [listener client](../../libs/listener-api.client/src/rpc-client.ts) catches most such typos at compile time.
- Rules 4 and 5 pull in opposite directions for shared schemas: a contract response schema that clients parse is tolerant, yet tests must check responses strictly. How tests obtain a strict check without a second hand-written schema is left to the implementation. Likewise, an owning package's schema may itself be strict, such as `accountOutcomeSchema`; a response shape derived from it under rule 6 must not carry that strictness to clients.
- Tolerance covers added fields only. Removing, renaming, or narrowing a response field still breaks installed apps, so such changes need the same care as before.
- Contract packages depend on the owning packages' contract entry points, such as `@cup/accounts/contracts`, not on their main entry points, so clients that import a contract do not pull in Worker code.

### Implementation status

This decision is accepted. patricktree/cup#30 implements rules 1 and 4 for the listener contracts and the web app: listener request and response schemas drop unknown keys, and strict shared schemas are rebuilt from their shapes on the listener side. patricktree/cup#29 implements rule 6 for the operator contracts: the account inspection response composes the schemas from `@cup/accounts/contracts` instead of copying them. patricktree/cup#31 implements rule 5 for the operator account responses. Rule 5 also holds for the listener API: listener handlers copy each declared field from Durable Object results through the [listener response mappings](../../libs/api-server/src/listener-responses.ts), so internal fields such as an outcome's `audiobookReference` and `failureCategory` stay out of responses, and they type their responses with `satisfies` instead of parsing them. The [listener route tests](../../libs/api-server/test/listener-responses.test.ts) parse every successful listener JSON response with a [strict variant](../../libs/api-server/test/strict-schema.ts) that is derived from the tolerant contract schema. The listener `historyItemSchema` picks its fields from [`@cup/accounts/contracts`](../../libs/accounts/src/account-contracts.ts), and the listener `accountSnapshotSchema` rebuilds the account snapshot and duration balance from their shapes there without `.strict()` (rule 6). Operator response schemas, including the strict `grantSnapshotSchema` from the [grant contracts](../../libs/conversion-grants/src/domain/grant-contracts.ts) that they embed, call `.strict()`. This satisfies rule 4, because no client parses operator responses at runtime: the [operator CLI](../../apps/operator/src/cli.ts) parses only its options and request bodies, and the [operator client](../../libs/operator-api.client/src/rpc-client.ts) reads responses through the shared [response handling](../../libs/api-rpc.client/src/rpc-response.ts) without a schema. The operator response schemas serve the [route definitions](../../libs/operator-api.routes/src/hono-app.ts) as types and strict checks in tests, as rule 5 requires. As of 2026-10-16, the decision is fully implemented.
