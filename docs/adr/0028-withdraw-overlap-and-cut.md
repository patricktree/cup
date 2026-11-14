---
status: accepted
---

# Withdraw overlap and cut

[ADR 0027](0027-flow-narration-across-segment-boundaries-with-overlap-and-cut.md) made overlap and cut Gemini speech policy 7: every audio segment after the first was synthesized with the previous narration chunk's last sentence in front, and the overlap was cut away at a cut point that Whisper large v3 turbo's word timing, aligned with the synthesized text by deterministic code, located and a cut check accepted. It was merged in [#336](https://github.com/patricktree/cup/pull/336) and deployed on 2026-11-13 for Linear CUP-58.

## Decision

- **Withdraw speech policy 7.** New conversions are prepared under speech policy 6 again, which synthesizes each narration chunk alone at policy 6's narration pace. The overlap-and-cut code, the speech recognition call, the speech recognition evals and their review-gate step are removed.
- **Keep what policy 7 stored readable.** Policy 7 stays a known speech configuration, so its manifests and audio segments still load and its narration pace still applies; a resumed policy 7 conversion synthesizes its remaining segments as policy 6 does, which is what policy 7 fell back to whenever its cut check failed. Synchronization units keep accepting the `continuesNarrationBlock` field that policy 7's narration document creation wrote, though nothing writes or reads it any more. Existing audiobooks are not re-synthesized.
- **Re-tackle segment boundaries through decoupled synthesis.** The next attempt is the map [#320](https://github.com/patricktree/cup/issues/320): synthesize larger narration chunks, transcribe their audio, and map the recognized words back onto the synchronization units, with a model rather than deterministic code doing that mapping. Linear CUP-58 holds what the first attempt learned.

## Why

- **The cut point depends on Whisper's word timing, which is wrong exactly where the cut belongs.** Whisper often starts the narration chunk's first word early, stretching it back over the pause in front of it. The search for the cut point ends where that word starts, so it never sees the real pause. Gemini returns no word timing ([#289](https://github.com/patricktree/cup/issues/289)), so nothing else locates the pause.
- **That failure goes both ways.** When the only silences left in the search are short gaps inside the overlap, the cut check fails and the segment falls back. When one of those gaps lasts 150 ms, the check accepts a cut inside the overlap, and the segment starts with part of the previous sentence again: an audible repeated word that the check was meant to prevent. On 2026-11-13, a production conversion fell back at 1 of 16 boundaries, and re-running that boundary live 11 times through the production code gave 2 fallbacks and, judged by silence positions and Whisper's word timing, 3 accepted cuts inside or before the overlap's last word.
- **Patching the rule moves the problem rather than solving it.** The search ends at the chunk's first word on purpose, so a one-word heading opening the chunk is not cut away; extending it past that word reintroduces that defect. Each fix of the deterministic rule so far (split numbers, lead-in silence, citation markers) traded one edge case for the next.

## Consequences

- Segment boundaries make fresh starts again, as before 2026-11-13.
- Segments again cost one synthesis each, with no speech recognition, and the segment step's timeout returns from 5 to 2 minutes.
- Audiobooks prepared under policy 7 on 2026-11-13 keep the audio they have, including any cut that landed inside the overlap.

## Evidence

- Production conversion `92ca68bc-fa8d-4b83-b369-4a41a9cba654` on 2026-11-13: one `overlap-and-cut-fallback` log with reason `cut-check-failed`, at sequence 16 of 17.
- Live re-runs of that boundary ("(Reuters, APA, Michael Windisch, 12.11.2026)" before "Hinweis: Dieser Artikel wird laufend aktualisiert, …") on 2026-11-13: in the failed takes the real pause before "Hinweis" lay at 5.53–6.35 s and 6.14–7.10 s while the longest silence the search could see lasted 50 ms and 40 ms; one accepted take cut at 2.85 s, before the date, with the real pause at 5.17–5.82 s.
