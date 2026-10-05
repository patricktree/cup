---
status: accepted
---

# Synthesize the selected unit while paused

Waiting for Play to synthesize the selected synchronization unit adds avoidable startup delay. The user chose to prepare that unit even when playback is paused.

## Decision

- Preparation still ends after publishing the narration document, without synthesizing speech.
- On initial player load, request audio for the selected unit, including a unit restored from the saved listening position. Remain paused.
- Seeking while paused requests only the destination unit. Completion never starts playback.
- Active playback requests the selected unit first and requests missing units within the 60-second speech synthesis lookahead in parallel.
- Reuse completed audio and in-flight requests. Respect generation authorization; unlisted readers without the owning trial session can only reuse existing audio.
- Pause stops synthesis ahead. Closing the player stops all new scheduling. In-flight work can finish and charge normally.
- Failed units require explicit retry. Speculative failures remain deferred until their unit is selected.

This partially supersedes [ADR 0005](0005-prepare-narration-before-player-controlled-synthesis.md) and [ADR 0003](0003-charge-for-accessible-generated-narration.md) only for synthesis triggers while paused. Their preparation, accounting, authorization, and retention decisions remain in effect.

## Consequences

Opening an article or selecting a passage can consume allowance without playback. Only the selected unit is requested while paused, and completed audio remains reusable. The [conversion architecture](../architecture/conversion.md) describes the current flow.
