# Reporting a pending conversion's preparation phase

Research date: 2026-10-27. Question: [#80](https://github.com/patricktree/cup/issues/80), on the map [#79](https://github.com/patricktree/cup/issues/79) (redesigned Recents screen and detail view, whose detail view shows "the skeleton with the preparation phase" while loading). All code claims were observed at commit `dcec7ecd` on `main`; the primary sources are this repository's code and its Git history. The Figma designs were not consulted (the Figma MCP was not authorized in this session), so whether a Recents card shows the phase is taken from the map's Notes, not from the designs.

## Answer

The trial side already does almost everything; the account side records nothing. The preparation workflow reports each phase through `ConversionExecution.phaseStarted`. For a trial conversion, the conversion grant stores it in `conversions.last_started_phase`; for an account conversion, the call only runs the execution fence and stores nothing. No listener response a client polls carries the phase: the audiobook response's `pending` variant has no phase field, and history items have none. The only route that returns a phase, `GET /api/conversions/{conversionId}`, has no caller in the web app, and for account conversions it always answers `conversion-start`.

Reporting the phase needs four changes: store it per account conversion (one account migration), make the account's `phaseStarted` record it inside the fence it already runs, carry it into the history item and the pending audiobook response, and render it. Neither poll needs to change: both already re-request while a conversion is pending.

## Where phases come from

- [`ConversionPhase`](../../libs/conversion-contracts/src/index.ts) has eight values with an order (`conversionPhaseOrder`): `conversion-start`, `source-material-preparation`, `narration-content-selection`, `narration-document-creation`, `audio-segment-production`, `audiobook-assembly`, `audiobook-storage`, `finalization`.
- The owner sets `conversion-start` when it accepts the conversion. The [preparation workflow](../../libs/create-audiobook-from-url-workflow/src/run-prepare-audiobook-workflow.ts) then calls `execution.phaseStarted` at the start of its durable steps: `source-material-preparation` (inside "prepare audiobook source material"), `narration-content-selection` (its own step, before the selection chunk steps), `narration-document-creation`, `audiobook-storage`, and `finalization` (inside "create ready conversion outcome" or "create failed conversion outcome").
- Nothing calls `phaseStarted` with `audio-segment-production` or `audiobook-assembly`. Since preparation and speech synthesis were split (commit `7f62af1a`, 2026-10-05), synthesis runs after the conversion is stored as `ready`, so those two values cannot occur while a conversion is pending. A listener sees at most six phases.
- `finalization` lasts only from the outcome step until the terminal record, so in practice a poll sees it rarely. The wait for the cover image, between document creation and storage, counts as `narration-document-creation`.
- Because `phaseStarted` runs inside `step.do` callbacks, a step whose result Workflows replays from its cache does not record the phase again; the stored value from the first run remains. A restarted instance (retry) re-runs every step and records each phase again.

## Where phases are stored

### Conversion grant (trial conversions)

- [`resolveConversionExecution`](../../libs/create-audiobook-from-url-workflow/src/conversion-execution.ts) maps the trial `phaseStarted` to `ConversionGrantDurableObject.recordPhaseStarted`, which writes `lastStartedPhase` in a storage transaction and refuses a conversion that is no longer pending ([grant object](../../libs/conversion-grants/src/durable-object/conversion-grant-durable-object.ts)).
- The column `last_started_phase` is `NOT NULL` for every status, constrained to the eight values ([grant schema](../../libs/conversion-grants/src/storage/grant-sqlite-schema.ts)). Starting a conversion and retrying preparation both set it to `conversion-start`; the terminal record keeps the last phase.
- `GrantSqlite.save` upserts every conversion row of the grant on each save, so each phase write rewrites all of the grant's conversions ([grant storage](../../libs/conversion-grants/src/storage/grant-sqlite.ts)). That is the existing pattern for every grant mutation, and a grant holds few conversions.
- [Durable Object storage](../architecture/durable-object-storage.md) documents that only grants keep `last_started_phase`, for the operator's inspection of trial conversions.

### Account (account conversions)

- The account `phaseStarted` is `account.assertExecution(conversionId, executionEpoch)`: it throws when the account is deleting, past its recovery deadline, on a different execution epoch, or when the conversion is neither pending nor ready. It stores nothing ([conversion execution](../../libs/create-audiobook-from-url-workflow/src/conversion-execution.ts), [account object](../../libs/accounts/src/durable-object/account-durable-object.ts)).
- `account_conversions` has no phase column ([account schema](../../libs/accounts/src/storage/account-sqlite-schema.ts)). `AccountSqlite.startConversion` and `retryPreparation` would be the places that set or reset it ([account storage](../../libs/accounts/src/storage/account-sqlite.ts)).
- Since the workflow already makes one account RPC per phase, recording the phase there adds a SQLite write to an existing round trip, not a new call.

## What the listener API returns today

| Route                                 | Used by                                                   | Pending trial conversion                                    | Pending account conversion                      |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `GET /api/audiobooks/{conversionId}`  | Reader (detail view), polled every second while pending   | `{ status: "pending", originalUrl, canGenerate }`, no phase | Same, no phase                                  |
| `GET /api/account/conversions`        | History, polled every 5 seconds while any item is pending | Not applicable: a grant session never lists conversions     | History item with `status: "pending"`, no phase |
| `GET /api/conversions/{conversionId}` | No web-app caller; E2E tests and one UI-gallery fixture   | `lastStartedPhase` from the grant                           | Always `lastStartedPhase: "conversion-start"`   |

Sources: [listener contracts](../../libs/listener-api.routes/src/contracts.ts) (`audiobookSchema`, `historyItemSchema`, `conversionDetailSchema`), [route definitions](../../libs/listener-api.routes/src/hono-app.ts), [API server](../../libs/api-server/src/api-server.ts) (`getAudiobook`, `getHistory`, `getAccountConversion`), [grant conversion use case](../../libs/api-server/src/use-cases/get-grant-conversion.ts), [conversion reader](../../libs/api-server/src/adapters/conversion-reader.ts), [history response mapping](../../libs/api-server/src/http/listener-responses.ts).

- `getAudiobook` reads the conversion through `ConversionReader.getConversion`, typed as `Pick<GrantConversion, "sourceUrl" | "status">`; for a trial conversion the grant's object already holds `lastStartedPhase`, so the trial half needs only a wider `Pick` and the response field.
- History items are built from `AccountHistoryItem` ([account contracts](../../libs/accounts/src/domain/account-contracts.ts)). That schema is strict and is also composed into the operator API's account inspection (`accountHistoryPageSchema` in [operator contracts](../../libs/operator-api.routes/src/contracts.ts)), so a new field there reaches the operator contract too.
- Until commit `7f62af1a`, the web app had a `/conversions/$conversionId` route that polled `GET /api/conversions/{conversionId}` and rendered `(n/8) <label>…` from `lastStartedPhase` with a client-side label map. That commit replaced it with the reader's skeleton, leaving the route without a web caller.

## How the polls would pick it up

- Reader: [`createAudiobookQuery`](../../apps/web-app/src/data-fetching/reader.ts) refetches every second while the status is `pending` or `synthesizing`, in the background too. A phase on the `pending` variant reaches the skeleton on the next poll with no query change; the [reader route](../../apps/web-app/src/routes/_shell.audiobooks.$conversionId.tsx) renders `<ReaderSkeleton />` for `pending` and would pass the phase to it.
- History: [`createAccountHistoryQuery`](../../apps/web-app/src/data-fetching/account-history.ts) refetches every 5 seconds while any loaded item is pending. TanStack Query refetches every loaded page of an infinite query, so phase changes on any visible card arrive within 5 seconds; a phase is short enough that some phases may never be seen on Recents. The map's Notes do not list a phase on Recents cards (pending cards are not among the "undesigned states"), so the history field may only matter if the Recents design asks for it.
- Trial conversions appear only in the reader, never in a history list, so for trial audiobooks only the audiobook response matters.

## Options

### Where the account stores the phase

1. **Column on `account_conversions`, recorded by a fenced account RPC (recommended).** Mirrors the grant: add `last_started_phase`, set `conversion-start` on start and on retry, and replace the bare `assertExecution` in the account `phaseStarted` with something like `recordPhaseStarted(conversionId, phase, executionEpoch)` that runs the same fence and then writes. One storage model for both owners; no new binding; same round trips. Costs one account migration. A table-level `check()` makes Drizzle Kit rebuild `account_conversions` and, because foreign keys stay enforced, the tables that reference it (`pending_jobs`, `audio_segments`), as [migration 0005](../../libs/accounts/drizzle/account/0005_align_duration_ledger_schema.sql) did; the [accounts README](../../libs/accounts/README.md) describes that procedure. A nullable column without a check avoids the rebuild but leaves validation to the application; rows pending at deploy time would read `null` either way and need a fallback (treat as `conversion-start`).
2. **Keep the phase only while pending.** A variant of 1: clear it on the terminal record. Saves nothing meaningful and loses the "which phase was it in when it failed" diagnostic that grants keep; accounts already record `failure_category`, which carries most of that.
3. **Ask Cloudflare Workflows.** Rejected by earlier research: the binding's `status()` has no step information, and the REST instance API does not work against local Wrangler and adds a credentialed control-plane call to every poll ([Workflow current-step introspection](cloudflare-workflow-current-step.md)).
4. **A separate store (registry, KV).** The registry is a single object every request already consults for ownership, and KV is eventually consistent; both add a dependency for data the owner already serializes. No advantage over 1.

### How the listener API exposes it

1. **Internal enum on the pending variants (`lastStartedPhase: ConversionPhase`).** Matches `conversionDetailSchema` and the old client. Exposes `audio-segment-production` and `audiobook-assembly`, which cannot occur while pending, and ties the public contract to internal phase names.
2. **A listener-facing preparation phase enum.** The server maps internal phases to a stable, smaller public set (for example the six reachable phases, or fewer coarser ones). Decouples workflow refactors from installed apps, at the cost of a mapping to maintain.
3. **Server-rendered label text.** Simplest client, but moves user-facing copy into the API and rules out client-side wording changes without a Worker deploy.

Compatibility matters for any of these: the Capacitor shells bundle the web app (`webDir` in [`capacitor.config.ts`](../../apps/mobile-app/capacitor.config.ts)), so installed apps parse responses from newer Workers. Listener schemas drop unknown fields, so adding a field is safe, but a `z.enum` field fails to parse when a newer Worker sends a value an installed app does not know. Whichever enum is exposed, the client should parse the phase tolerantly (for example fall back to no phase on an unknown value) or the enum must only ever grow in lockstep with app releases.

### Shape in each response

- Audiobook response: add the phase to the `pending` variant only. The other variants have no use for it.
- History item: add a nullable field present only for `status: "pending"`, or turn `outcome` into a status-discriminated union that carries it. The flat nullable field matches how `outcome` is modelled today. Because `AccountHistoryItem` is shared with the operator contract, the field also appears in operator account inspection, which is harmless and consistent with how operators already see trial phases.
- `GET /api/conversions/{conversionId}`: once accounts store the phase, its account branch can return the real value instead of `conversion-start`, or the route can be retired, since no client calls it.

## Recommendation

Store the phase on account conversions exactly as grants do (option 1), recorded by a fenced account RPC that replaces the bare `assertExecution`, and reset on retry. Expose it on the pending audiobook response for both owners, and on pending history items only if the Recents design uses it. Prefer a listener-facing phase enum covering the reachable phases, parsed tolerantly by the client, over the raw internal enum. This is a recommendation for the decision ticket, not a decision.

## Open points for the decision

- Name: the glossary has no entry for a conversion's phase. The ticket says "preparation phase", the code says `ConversionPhase` and `lastStartedPhase`; the decision should settle the term with the `domain-modeling` skill.
- Whether Recents cards show the phase at all (the map's Notes only require it on the detail view's loading skeleton).
- Whether to drop `audio-segment-production` and `audiobook-assembly` from `ConversionPhase`. Grant rows constrain the column to the eight values, so removing them needs a grant migration; only rows last written by a workflow from before `7f62af1a` can hold them.
- Whether `GET /api/conversions/{conversionId}` stays.

## Limits

- Not checked against the Figma designs.
- No code was run; phase timing (how long each phase lasts, and so how often a 5-second poll sees it) was not measured.
- Cloudflare behaviour is taken from the earlier [Workflow current-step introspection](cloudflare-workflow-current-step.md) research (2026-09-01), not re-verified.
