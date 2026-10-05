---
status: partially superseded by ADR 0006
---

# Prepare narration before player-controlled synthesis

[ADR 0006](0006-synthesize-the-selected-unit-while-paused.md) supersedes the requirement to wait for Play before synthesizing the selected unit and the no-generation rule for paused seeking. The preparation boundary, synthesis lookahead, accounting, authorization, and other choices below remain accepted.

The reading flow opens a narration view with title and paragraph skeletons once the server admits the source URL submitted using `Load & listen` and returns its conversion identity. Preparation fills in the source title and narration document and finishes without generating speech. Play remains disabled until preparation finishes; pressing Play then initiates progressive speech generation with a bounded speech synthesis lookahead rather than eagerly producing the entire audiobook. This follows the progressive-generation direction in [ADR 0003](0003-charge-for-accessible-generated-narration.md).

The user accepted this design for implementation. [Conversion architecture](../architecture/conversion.md) describes preparation, progressive delivery, and platform limitations.

## Settled choices

- Keep the current one-to-one mapping between synchronization units, narration chunks, and audio segments. Each synchronization unit is independently generated and playable.
- Target a speech synthesis lookahead of roughly 60 seconds of estimated audio, requesting whole units. Long units may exceed the target; short units may require several requests. On Play, request the current unit first, then immediately request missing units within the speech synthesis lookahead in parallel while the current unit is still generating, reusing in-flight requests.
- Navigate after successful admission; submission errors remain on the submission form.
- Retain ADR 0003's pause policy: stop scheduling new synthesis while allowing in-flight synthesis to finish and charge for accessible results.
- Seeking while playing prioritizes the destination unit and requests speech synthesis lookahead from there, leaving intervening units ungenerated. Seeking while paused changes the playback position without generating audio until Play; previously requested work may finish.
- Playback and progressive generation should continue in the background while playback remains active, including tab switches and phone locking. Pause or closing the player stops new scheduling; already requested work may finish. Browser and native-platform support requires implementation verification.
- After automatic retries are exhausted, stop playback at the failed unit and offer Retry. Keep the document and completed audio accessible; skipping a failed unit requires an explicit listener action.
- Preparation has its own completion state, and audio availability is tracked per unit. A complete audiobook requires audio for every unit; text readiness enables Play without implying complete audio.
- Restore the saved listening position only on the player's initial load, including refreshes and later visits. Restore the narration document and available audio, but remain paused until Play. Reuse generated audio without charging again.
- Multiple players may listen independently at different positions, with their own speech synthesis lookahead and shared generated audio. Coordinate requests for the same unit so concurrent players generate it once and charge once; each active player may request units around its own position.
- Allow preparation without available audio duration for an active account or open trial grant, retaining admission rate limits. Require allowance for new synthesis. If available duration cannot cover the next unit, stop there and explain the limit while preserving the document and completed audio.
- New trial synthesis requires a session for the conversion's owning grant. An unlisted article link alone permits reading the document and playing completed audio, without permission to spend the grant's allowance.
- Persist one listening position per signed-in user and conversion on the server with last-write-wins updates. Store the synchronization unit and the offset within its audio, without requiring a complete-track timeline. An already loaded player keeps its own position and does not follow subsequent saved-position updates; opening the conversion on another device restores the latest saved position. Anonymous trial listeners retain browser-local positions and do not share progress through the owning grant.
- Remove the assembled MP3 track, its download, and EPUB exports. Retain MP3 encoding for individual audio segments, which the reader plays directly. All-unit audio availability does not trigger full-track assembly or enable exports.
- After automatic preparation retries fail, replace skeletons with an error and a Retry action. Retry preparation on the same conversion; keep Play disabled until preparation succeeds.
- Defer a separate control for explicit generation cancellation. Play/Pause remain the playback controls for this change; ADR 0003's policy for explicit cancellation remains applicable to a future cancellation feature.

## Relationship to existing decisions

This decision supersedes [ADR 0001](0001-use-a-canonical-synchronized-audiobook.md): the canonical reader model becomes a prepared narration document with independently available audio segments and unit-local synchronization, replacing the single complete MP3 track and full-track synchronization timeline. Retain its safe document structure, spoken title, and coarse synchronization-unit boundaries. Preparation completion and each unit's audio availability are independent; generating every unit is not required for the reader to be available.

Retain ADR 0003's generated-duration accounting and authorization policies, including reservations before synthesis, charging only accessible completed audio, free reuse, and preserving completed audio when generation stops. This decision resolves its deferred speech synthesis lookahead and progressive delivery choices without adding the deferred explicit cancellation control.

## Acceptance and verification

Preparation completion uses the existing `ready` conversion status. The prepared manifest stores the narration document and speech configuration; unit audio availability comes from independent workflows and owner settlement records. No full-track artifact is produced. The player restores position once and writes serialized last-write-wins saves thereafter.

Native Android and iOS engines own playback and scheduling independently of their WebViews. Native build checks do not establish physical-device lock-screen behavior; device verification must cover continuous generation, audio interruptions, and authentication expiry. Browser background execution remains subject to browser and operating-system suspension. Private copying of trial conversions remains outside this change.
