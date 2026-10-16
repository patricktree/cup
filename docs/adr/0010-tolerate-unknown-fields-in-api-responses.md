---
status: accepted
---

# Tolerate unknown fields in API responses

Clients parse API responses with zod schemas shared with the server. Many of those schemas were `.strict()`, so a response carrying a field the client did not know failed to parse. On 2026-10-16 the operator API failed three times in production for this reason: strict response schemas rejected a `hasCoverImage` history field, derived conversion statuses, and a balance `unit` that the server legitimately returned. The listener API has the same exposure with a longer tail: an installed Android app keeps running old client code against the newest Worker, so every field the Worker adds to a response would make that app fail to read it. On 2026-10-16 the user chose to keep request validation strict and make only the schemas clients use to read responses tolerant.

## Decision

- Servers reject unknown fields in requests. Schemas that validate client input (route parameters, request bodies) stay `.strict()`.
- Clients drop unknown fields in responses. Response schemas use zod's default object behavior, which strips keys the schema does not declare; parsed values carry only the declared fields.
- When a schema serves both sides, split it: the request side stays strict, and the response side is rebuilt from the same shape without `.strict()`. Nested objects follow the side of the schema that embeds them. In the [listener contracts](../../libs/listener-api.routes/src/contracts.ts), playback positions, duration balances, synchronization units, and grant snapshots are rebuilt this way, while storage, workflow, and operator schemas in other libraries stay unchanged.
- Response schemas strip rather than pass unknown fields through, because no client reads undeclared fields.
- Enums and literals in response schemas are unchanged: a value the client does not know still fails to parse. Adding an enum value remains a compatibility change that needs a client release first or a separate decision.

## Considered options

- Keep strict response schemas and release clients before servers. Rejected: installed apps update on their own schedule, and Worker deployments are immediate.
- Pass unknown fields through. Rejected: it widens parsed types with index signatures and lets values no client has validated flow into client state.
- Version the API for each response change. Rejected as disproportionate for additive fields.

## Consequences

- The server can add response fields without breaking installed apps. Removing or renaming a field, changing its type, or adding an enum value still breaks older clients.
- Contract tests no longer catch a server that sends an unexpected response field; the field is dropped silently instead. The server's own output check of audiobook responses strips such fields instead of failing the request.
- Implementation gap: the listener contracts follow this decision; the operator contracts are not yet checked against it and are being reworked separately.
