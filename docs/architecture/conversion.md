# Conversion from source URL to audiobook

The API admits preparation, an account or conversion grant owns allowance and outcomes, and Cloudflare Workflows runs durable processing steps. R2 stores the prepared narration document and one independently stored audio segment per synchronization unit. [ADR 0008](../adr/0008-synthesize-the-whole-narration-document.md) records why the whole document is synthesized as part of the conversion; [glossary](../GLOSSARY.md) defines the representations.

Two workflows run in the same Worker: [PrepareAudiobookWorkflow](../../libs/create-audiobook-from-url-workflow/src/prepare-audiobook-workflow.ts) prepares the document, and [SynthesizeAudioSegmentWorkflow](../../libs/create-audiobook-from-url-workflow/src/synthesize-audio-segment-workflow.ts) generates one segment. Each instance has a stable identity derived from its conversion, and for a segment its sequence, so dispatch, recovery, and retries resolve to the same instance. The [Worker configuration](../../apps/cloudflare-worker/wrangler.jsonc) declares their bindings.

Both runners act through a [conversion execution adapter](../../libs/create-audiobook-from-url-workflow/src/conversion-execution.ts) that captures the conversion owner, conversion ID, and execution epoch. The adapter does not cache lifecycle authorization: the owning Durable Object still checks every effect, and account writes also go through the account's fenced artifact writer.

```mermaid
sequenceDiagram
    participant Client as Reader
    participant API as Worker API
    participant Owner as Account or Grant DO
    participant Preparation as Preparation Workflow
    participant Segment as Segment Workflows
    participant AI as AI Gateway
    participant R2
    Client->>API: Submit URL
    API->>Owner: Authorize and admit preparation
    Owner->>Preparation: Dispatch preparation
    API-->>Client: Conversion identity
    Client->>Client: Navigate to reader skeletons
    Preparation->>Preparation: Prepare source material
    par Beside content selection
        Preparation->>AI: Select narration content
    and When the source page declares one
        Preparation->>R2: Store fetched cover image
    end
    Preparation->>R2: Store document and speech configuration
    Preparation->>Owner: Set ready outcome with every segment's text length
    alt Whole-document estimate exceeds available duration
        Owner->>Owner: Record outcome, reserve nothing
        Client->>API: Poll audiobook
        API-->>Client: Document, needed and available duration
    else Estimate fits
        Owner->>Owner: Record outcome and reserve every segment
        Preparation->>Owner: Start synthesis
        Owner->>Segment: Dispatch all segment workflows
        par Every segment at once
            Segment->>AI: Synthesize narration unit
            Segment->>R2: Store immutable MP3 segment
            Segment->>Owner: Settle encoded duration
        end
        loop Until every segment has audio or a final failure
            Client->>API: Poll audiobook
            API->>Owner: Check authorization, read segment states
            API-->>Client: Document and per-segment state
        end
        Client->>Client: Enable Play with the exact total duration
    end
```

## Preparation

After the server accepts the request and returns a conversion ID, the app navigates to the reader, which shows skeletons until preparation finishes. Preparation uses [source material](../../libs/prepare-source-material/), [narration selection](../../libs/narration-content-selection/), and [document creation](../../libs/narration-document-creation/). It stores the document with its speech configuration, so later generation and retries use the same model and voice, and records the preparation outcome together with every segment's text length. The owner reserves the whole document, or nothing, in the same transaction that records the outcome, so a prepared conversion never has undecided reservations; [`provider-failure.test.ts`](../../libs/create-audiobook-from-url-workflow/test/provider-failure.test.ts) covers both cases. As its final step the workflow asks the owner to dispatch the reserved segments. The owners store the outcome as `pending`, `ready`, or `failed`; the status shown to clients is derived from it together with the segment states.

Active accounts and open, unexpired conversion grants may prepare audiobooks without available duration; such an audiobook stays readable without audio. Per-owner admission limits still apply. A failed preparation shows an error and a Retry, which restarts preparation for the same conversion.

Narration content selection keeps complete paragraphs of main prose, including instructional prose, and leaves out code blocks and shell snippets; it reconstructs the source material from the original HTML, so source wording and native anchors are preserved. The [live evals](../../libs/narration-content-selection/test/evals/README.md) compare the resulting synchronization units exactly against committed goldens.

Preparation outcomes contain no audio duration or speech-provider usage; generated duration is recorded per segment by the owner's duration accounting. Grant outcomes additionally record narration measurements and content-selection provider usage for operator inspection.

## Cover image

Preparation keeps the cover image a source page declares in its metadata, when it can; [declaration extraction](../../libs/prepare-source-material/src/prepare-source-material.ts) prefers the rendered page's declaration, because a static shell often declares only a site-wide image. No client displays it yet: it is stored, recorded, and served, so a surface that shows it needs only client work.

A separate workflow step fetches the image while narration content is selected, in its own browser session after source preparation closed the first, which keeps it self-contained and retryable. A browser is used instead of a Worker `fetch` because publishers refuse non-browser clients: on 2026-10-13 Gates Notes answered a plain request carrying a browser user agent with `403 Access Denied`. The [browser fetch](../../libs/prepare-source-material/src/load-cover-image.ts) keeps only raster formats identified from the leading bytes, refuses SVG because it can carry scripts, and requires public destinations; [`load-cover-image.test.ts`](../../libs/prepare-source-material/test/load-cover-image.test.ts) covers these rules. Request interception does not see redirect hops, so a hop to a non-public host is detected only after the response and the result discarded; the same limitation applies to source pages.

Keeping the image is best-effort: a refusal, timeout, or browser failure leaves the audiobook without one, logged with its reason, and never fails the conversion. When preparation fails for another reason, the failure is recorded only after a running cover image step has finished, so the step cannot write into a conversion that is being cleaned up. Audiobooks prepared earlier have none and are not backfilled.

The image is copied rather than linked so that opening a private audiobook does not disclose the reader to the publisher, the content security policy can keep images same-origin, and the copy is erased with the account. Only the image the manifest records is served ([`trial-audiobook-access.test.ts`](../../libs/api-server/test/trial-audiobook-access.test.ts)); [R2 objects](r2-storage.md#objects-within-a-conversion) describes what is stored.

## Whole-document synthesis and accounting

Each synchronization unit maps to one narration chunk and one independently stored MP3 segment. Preparation limits a document's narration characters and units, which bounds a single dispatch.

The owner estimates every segment still lacking audio and reserves all of them in one transaction, or none when their sum exceeds the available duration, both when the ready outcome is recorded and whenever synthesis is started. Settled and reserved segments are left untouched, so one operation serves the first run, a retry of failed segments, and a retry after insufficient duration. An expired or revoked grant refuses new reservations while reserved work finishes. Starting synthesis dispatches one workflow per reserved segment under the owner's concurrency gate, so concurrent retries cannot restart each other's instances.

Dispatch does not pace instance creation across owners, so it does not enforce the Workflows creation rate limit; a refused creation is retried by the preparation workflow and the owner alarm, so segments start late rather than being lost. This is untested under load, and no ceiling limits concurrent synthesis.

Each segment workflow synthesizes, publishes, and settles independently, charging the actual encoded duration once and reusing audio a previous attempt already published. Transient provider errors are retried within the step, and a provider rate limit makes the workflow wait rather than fail. A segment that still fails releases only its own reservation and stores an explanation; completed segments stay stored and charged. A segment workflow never reserves for itself, so a reservation always comes from the whole-document step. **Gap:** the owner objects still expose a per-segment `reserveAudioSegment` RPC that only tests call, so this holds by convention rather than through their interfaces.

While segments are reserved, the owner's alarm treats each reservation as synthesis still owed: it creates a missing workflow and restarts an errored one, and releases a reservation only when its workflow was terminated or errored after the account can no longer execute work ([`reconcile-segment-workflow.test.ts`](../../libs/conversion-contracts/test/reconcile-segment-workflow.test.ts)). [ADR 0003](../adr/0003-charge-for-accessible-generated-narration.md) defines capped overruns and free reuse. Synthesis runs on the server once started; leaving the reader does not stop it, and there is no cancellation.

## Status and retries

A prepared conversion's [status](../GLOSSARY.md#conversion-status) is derived from the owner's reservations and settlements, without querying workflows: a settled segment is ready, a reserved one is generating, a released one has failed, and a segment without a reservation means the document did not fit. The shared [status rule](../../libs/conversion-contracts/src/duration-accounting.ts) serves conversion detail and account history, and the [synthesis-state use case](../../libs/api-server/src/use-cases/get-synthesis-state.ts) applies it per segment ([`get-synthesis-state.test.ts`](../../libs/api-server/test/get-synthesis-state.test.ts)).

Operator grant inspection and a grant's conversion list still show the stored preparation outcome. One retry route restarts a failed preparation or, for a prepared conversion, starts synthesis again for whatever lacks audio, and reports the needed and available duration when it is refused. The reader keeps Play disabled until every segment has audio or a final failure, marks failed segments, and asks for an explicit choice to play without them; the [reader route tests](../../apps/web-app/src/routes/_shell.audiobooks.$conversionId.test.ts) cover these states, refused retries, and failed polls.

Sources: [preparation runner](../../libs/create-audiobook-from-url-workflow/src/run-prepare-audiobook-workflow.ts), [segment runner](../../libs/create-audiobook-from-url-workflow/src/run-audio-segment-workflow.ts), [segment dispatch and alarm reconciliation](../../libs/conversion-contracts/src/index.ts), [duration ledger](../../libs/duration-ledger/src/duration-ledger.ts), and [segment reuse](../../libs/audiobook-production/src/produce-audio-segment.ts).

## Playback

Players build one whole-audiobook [timeline](../../apps/web-app/src/app/player/audiobook-timeline.ts) from the ready segments' durations in document order; segments without audio take no time, so the total duration is exact before playback starts. Players load the following segment before the current one ends, so a segment boundary has no loading pause.

| Platform | Engine                                                                                                                                                        | Timeline in system media controls                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Browser  | Two alternating audio elements: one plays, the other preloads the following segment ([element pair](../../apps/web-app/src/app/player/audio-element-pair.ts)) | Media Session position state and seek handler                                     |
| Android  | A Media3 playlist with one item per segment                                                                                                                   | The session's player reports the whole duration and position and translates seeks |
| iOS      | A queue player holding the current and following segment                                                                                                      | Now-playing duration and elapsed time, and the change-playback-position command   |

Mobile Safari starts an audio element only after a user gesture, so the browser player's [state machine](../../apps/web-app/src/app/player/audiobook-player-machine.ts) starts both elements synchronously within the transition handling Play, never in invoked or asynchronous actors; an element without a segment plays a short same-origin silence file, because the content security policy allows no data or blob media. A seek to a segment neither element holds loads it into the standby element and swaps, because replacing the playing element's source makes Android browsers recreate their media notification. [`audiobook-player.test.ts`](../../apps/web-app/src/app/player/audiobook-player.test.ts) covers these transitions; behavior on physical devices, including lock-screen continuity, still needs verification.

## Delivery, positions, and lifecycle

The reader receives prepared text independently of segment states; [R2 access](r2-storage.md#access-and-lifecycle) states which objects can be delivered. The [delivery handlers](../../libs/api-server/src/http/serve-audiobook.ts) support HEAD and ETag requests, and audio also byte ranges. [Authentication](authentication.md) states who may read and replay.

Each signed-in listener has one saved position per conversion, a synchronization unit and an offset within its audio, which the server replaces on every save; anonymous positions stay on the device. A loaded player is never moved by query refreshes or other devices' saves, so device switches resume from the last successful save. The web application's [`PlaybackSession`](../../apps/web-app/src/app/player/playback-session.ts) resolves a saved position to a playable one and hands native engines the result; the native coordinators implement the same rule. [`playback-session.test.ts`](../../apps/web-app/src/app/player/playback-session.test.ts) covers resolution, save ordering and pacing, and the refusal of saves for a user who is no longer signed in.

The web application holds one player for every page inside its [app shell](../../apps/web-app/src/routes/_shell.tsx), so playback continues while the listener moves between pages. Its [player host](../../apps/web-app/src/app/player/player-host.ts) holds at most one loaded audiobook, keeps it playing until the listener plays another, swaps in a newer version with more audio once playback pauses (a new player could start only from a user gesture), and unloads on leaving the shell or a change of the signed-in user; [`player-host.test.ts`](../../apps/web-app/src/app/player/player-host.test.ts) holds these rules. Native Android and iOS coordinators own playback intent and the timeline while their WebViews are suspended; see [native playback components](../../apps/mobile-app/README.md#playback).

Ownership parameters and account execution epochs fence segment generation and artifact writes, and the shared [artifact prefix](../../libs/conversion-contracts/src/artifact-prefix.ts) covers preparation, audio, delivery, and deletion. Retries do not make provider requests, R2 publication, owner settlement, and workflow dispatch atomic. See [account deletion](account-deletion.md) for cleanup responsibilities.
