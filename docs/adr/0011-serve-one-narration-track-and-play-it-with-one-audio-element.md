---
status: partially superseded by ADR 0013
---

# Serve one narration track and play it with one audio element

[ADR 0013](0013-cache-cover-images-in-the-browser-for-a-day.md) supersedes this decision for the token lifetime only: signed media URLs now take the start of the current UTC day as their issue time and expire 48 hours after it, instead of 24 hours after issuance. Everything else below remains accepted, and the original decisions are preserved as historical rationale.

[ADR 0008](0008-synthesize-the-whole-narration-document.md) kept one MP3 per audio segment and made each player stitch them into one timeline: two alternating `<audio>` elements, a silence file and an XState machine in the browser, and native playlists on Android and iOS. On Android and iOS the browser player pauses 10–20 seconds after the device is locked, and on Safari pressing Play sometimes plays two audios at once. [patricktree/cup#58](https://github.com/patricktree/cup/issues/58) traced the locked pause to the element pair: the next segment starts from an `ended` handler, which a locked device does not run in time. Media authorization was a cookie that expires with the bearer token (about an hour) and that the Capacitor WebViews never send. The map [patricktree/cup#56](https://github.com/patricktree/cup/issues/56) and the spec [patricktree/cup#64](https://github.com/patricktree/cup/issues/64) (2026-10-27) chose to fix playback by simplifying delivery.

## Decision

- **One served MP3.** Every audiobook whose segments all have settled audio is served as one MP3, its narration track, joined from the stored segment objects per request. Nothing is stripped, added or stored. Synthesis, storage, settlement and retries stay per segment as ADR 0008 describes. [patricktree/cup#59](https://github.com/patricktree/cup/issues/59) and [patricktree/cup#62](https://github.com/patricktree/cup/issues/62) showed that separately encoded segments join into one accurately seekable track when every frame has the same length, so the segment format is fixed at 128 kbps without padding and a segment's byte length derives from its settled duration (× 16). Any future change to the segment encoding must start recording segment byte lengths.
- **Signed track URL instead of the media cookie.** A stateless token in the URL's `token` query parameter authorizes the narration track and the cover image: an HMAC over the audiobook ID, the principal (account or grant) and an expiry 24 hours after issuance. Every request still runs the principal's authoritative access checks ([patricktree/cup#60](https://github.com/patricktree/cup/issues/60)). The media cookie is removed.
- **One `<audio>` element and no player state machine.** The web player plays `narrationTrack.url` with one element and reads playing, buffering, position and duration from it. The timeline comes from the start offsets the audiobook response lists. The listening position stays a synchronization unit and an offset.
- **Native players removed.** Android and iOS shells play through the web player in their WebView, best effort, until [patricktree/cup#55](https://github.com/patricktree/cup/issues/55) ([patricktree/cup#61](https://github.com/patricktree/cup/issues/61)).
- **No playing without failed segments.** A narration track exists only when every segment has audio, so an audiobook with a failed segment is not playable until Retry succeeds.
- **System media controls use browser defaults.** The player sets only the media session metadata (title and artwork) and registers no action handlers or position state.

## Considered options

- Keep per-segment files and fix the element pair. Rejected: starting the next segment depends on script running at the boundary, which a locked device throttles, and each platform keeps its own timeline logic.
- Store an assembled track after synthesis. Rejected: a second artifact and a failure point; the per-request join needs no storage because the layout derives from the settled durations.
- Strip each segment's encoder priming or add a whole-track Info header. Rejected: about 50–60 ms of silence per join is acceptable, and changing bytes would break the byte-length derivation.
- Keep the media cookie and extend its lifetime. Rejected: the Capacitor WebViews do not send it, and its renewal ties playback to the bearer token's lifetime.

## Relationship to existing decisions

This partially supersedes [ADR 0008](0008-synthesize-the-whole-narration-document.md): no full track, the element pair, the native playlists, the players switching together, and playing without failed segments. ADR 0008's whole-document synthesis, all-or-nothing reservation and per-segment settlement stand. It partially supersedes [ADR 0009](0009-use-xstate-for-client-lifecycle-state-machines.md) for the player; the account session machine stays. [ADR 0007](0007-require-active-grant-access-for-trial-audiobooks.md) holds: expiring or revoking a grant blocks the next track request.

## Consequences

- Locked playback no longer depends on script at segment boundaries; the browser streams one file.
- Each join carries about 50–60 ms of silence (encoder priming plus padding), and segment start offsets are not corrected for the constant decoder delay.
- A leftover signed URL stays usable for at most 24 hours by a principal that still has access; local sign-out does not invalidate it.
- Audiobooks converted before the switch may stop playing; there is no migration.

### Implementation status

Implemented on 2026-10-27 by patricktree/cup#65 to patricktree/cup#71 (pull request patricktree/cup#73). The [conversion architecture](../architecture/conversion.md#playback) describes the route and the player, and the [authentication architecture](../architecture/authentication.md#signed-media-url) the signed media URL and its renewal. The operator verified playback on physical devices in patricktree/cup#72.
