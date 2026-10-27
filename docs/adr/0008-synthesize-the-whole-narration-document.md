---
status: partially superseded by ADR 0011
---

# Synthesize the whole narration document

[ADR 0011](0011-serve-one-narration-track-and-play-it-with-one-audio-element.md) supersedes the rejection of a full track, the browser's two alternating audio elements, the native playlists, the browser, Android and iOS players switching together, and playing without failed segments: every audiobook is now delivered as one narration track, played with one audio element, and playable only once every segment has audio. Whole-document synthesis, the all-or-nothing reservation and per-segment settlement remain accepted. The original decisions below are preserved as historical rationale.

Progressive, player-controlled synthesis left the audiobook's total duration unknown until every segment had been listened to. A consistent playback progress, in the app and in the Android and iOS media notification controls, was therefore very difficult to show. On 2026-10-11 the user chose to generate audio for the whole narration document as part of the conversion, favoring simplicity and exact progress over paying only for audio that is listened to. [Conversion architecture](../architecture/conversion.md) describes the implementation.

## Decision

- Start speech synthesis automatically once preparation publishes the narration document. The player no longer requests or schedules synthesis, and the speech synthesis lookahead is removed.
- Reserve the estimated duration of every segment still lacking audio in one all-or-nothing step, using the existing estimate. If the whole document does not fit the available duration, generate nothing. This is not a failed conversion: the document stays readable, the reader is told the needed and available durations, and a retry repeats the check.
- Dispatch every segment at once without a concurrency ceiling. Rate-limit responses from the speech provider wait and retry long enough to outlast a per-minute limit rather than failing the segment.
- Keep one independently stored MP3 per synchronization unit, settled and charged per segment as it is produced. No full track is assembled. The audiobook exposes every segment's duration so players present one whole-audiobook timeline.
- Conversion status describes the whole conversion: pending, synthesizing, ready, or failed, with insufficient duration as its own state. The document can be read while synthesizing, with generation progress shown as completed segments out of the total.
- Play stays disabled until every segment has audio or a final failure. A segment that exhausts its retries releases only its own reservation; completed segments stay stored and charged. The reader highlights failed segments and offers one Retry for all of them and an explicit choice to play without them. Skipped segments have zero length on the timeline, and Retry remains available afterwards.
- Synthesis continues and is charged when the reader leaves. There is no cancellation control.
- Expiry or revocation of a grant lets already reserved synthesis finish and blocks the new reservation a retry needs.
- The saved listening position remains a synchronization unit and an offset within its audio; the whole-audiobook position is derived.
- Players load the following segment ahead of the boundary so playback continues without a loading pause between segments. Every segment exists before Play, which makes this possible without assembling a track. Android and iOS use their engines’ playlists; the browser alternates two audio elements, one playing and one preloading. Silence contained in the audio itself is left as produced.
- The browser, Android, and iOS players switch together. Conversions created under progressive synthesis are not migrated and may stop working; no users depend on them.

## Considered options

- Keep progressive synthesis and show progress from estimated durations. Rejected: the estimate differs from encoded audio, so the timeline would shift as segments arrive, and three players would keep their scheduling logic.
- Assemble one MP3 track. It gives native media controls a single timeline for free, but restores an assembly step, a second artifact, and a failure point. Rejected in favor of mapping the segment queue onto one timeline in each player.
- A fixed concurrency ceiling per conversion. Rejected: the provider limit is shared by the whole Google project, which a per-conversion ceiling does not protect, and it would slow ordinary articles.

## Relationship to existing decisions

This supersedes [ADR 0006](0006-synthesize-the-selected-unit-while-paused.md) and the synthesis triggers, speech synthesis lookahead, seek-driven generation, independent per-player scheduling, and preparation-only `ready` status of [ADR 0005](0005-prepare-narration-before-player-controlled-synthesis.md). ADR 0005's preparation boundary, one-to-one mapping of synchronization units to audio segments, removal of the assembled track and exports, and listening position remain in effect.

It partially supersedes [ADR 0003](0003-charge-for-accessible-generated-narration.md): pausing no longer affects synthesis, the deferred explicit cancellation is dropped, and a request is now the whole document rather than one segment. Its duration accounting otherwise stands, including estimates, per-segment settlement, capped overruns, and free reuse. [ADR 0007](0007-require-active-grant-access-for-trial-audiobooks.md) is unchanged.

## Consequences

- Submitting a source URL spends allowance for the whole article before the user has seen its text, and regardless of how much is listened to.
- The conservative estimate blocks some documents that would have fit the available duration.
- Charged audio is not playable until the remaining segments finish or finally fail; playing without failed segments keeps it accessible.
- Listening starts after the slowest segment rather than the first. With full parallelism this is roughly one segment's synthesis time for ordinary articles.
- Provider limits bound the burst. On 2026-10-11 the AI Studio dashboard showed Tier 3 limits for Gemini 3.8 Flash Lite TTS of 1,000 requests per minute, 1 million input tokens per minute, and no daily request limit, for the project displayed there. Requests reach Google through a key stored in AI Gateway, so that key's project limits apply; whether the displayed project owns the stored key was not verified.
- Mobile Safari starts an audio element only after a user gesture, so both browser audio elements must be started within the Play action. This needs verification on a physical iPhone, including with the screen locked.
- Native media controls must present the whole-audiobook duration and position and translate seeks to a segment and offset.
