---
status: accepted
---

# Cache cover images in the browser for a day

The redesigned Recents screen shows each ready audiobook's cover on its card ([patricktree/cup#89](https://github.com/patricktree/cup/issues/89)). Cover images were served `private, no-store` through a [signed media URL](../architecture/authentication.md#signed-media-url) whose token changed on every response, because it carried the exact issue time. Every poll, page load and app start therefore produced new URLs, and browsers downloaded every cover again: covers popped in on each app start, and the detail view re-downloaded its cover on every 1-second poll. [patricktree/cup#83](https://github.com/patricktree/cup/issues/83) compared the options, and [patricktree/cup#86](https://github.com/patricktree/cup/issues/86) (2026-10-27) chose one. [patricktree/cup#101](https://github.com/patricktree/cup/pull/101) (commit `8cccf1e`) implemented it.

## Decision

- **One signing window per UTC day.** Every signed media URL, for covers and narration tracks, issued to accounts and grants alike, takes the start of the current UTC day as its issue time and expires 48 hours after it. Within one UTC day the same audiobook and principal always get a byte-identical URL, and every URL stays valid for at least 24 hours after it is handed out.
- **Covers are cached for a day.** Successful cover responses (`GET` and `HEAD`, including `304`) send `Cache-Control: private, max-age=86400, immutable`. Cover error responses, the narration track and every other response keep `private, no-store`.
- **Uncached requests keep every check.** A request that reaches the Worker still runs the principal's authoritative access checks of [ADR 0007](0007-require-active-grant-access-for-trial-audiobooks.md).
- **History items carry the cover URL.** A ready history item with a cover gets a signed cover URL issued to the account, so Recents cards need no audiobook request per card.

This works without client JavaScript: the browser's HTTP cache serves an `<img>` whose URL it has seen within the day.

## Considered options

- **Hourly signing windows.** Rejected: covers would still download again every hour, and the gain in a shorter leftover-URL lifetime is small.
- **`no-cache` with ETag revalidation.** Rejected: each cover still costs a round trip on every app start, and the image pops in after the revalidation.
- **Never-expiring cover tokens.** Rejected: a leaked URL would stay a bearer credential for as long as the principal keeps access, and the token would need to differ from the narration track's.
- **A route authorized by a request header.** Rejected: `<img>` cannot send headers.

## Relationship to existing decisions

This partially supersedes [ADR 0007](0007-require-active-grant-access-for-trial-audiobooks.md) for cover responses only: a browser may now show a cover from its cache without asking the Worker. It also replaces the 24-hour token lifetime that [ADR 0011](0011-serve-one-narration-track-and-play-it-with-one-audio-element.md) records with the UTC-day issue time and 48-hour lifetime above; the player's 12-hour renewal of ADR 0011 still holds, because every URL stays valid for at least 24 hours after it is handed out.

## Consequences

- The first cover load after UTC midnight downloads each cover again. A running page keeps showing the old image until the new URL has loaded.
- After revocation, grant expiry or account deletion, a device's browser cache keeps a cover for up to a day. The UI cannot show it, because cover URLs come only from access-checked audiobook and history responses.
- A leftover signed URL stays usable for up to 48 hours by a principal that still has access, instead of 24.
- [`signed-media-url.test.ts`](../../libs/api-server/test/signed-media-url.test.ts) covers the identical URLs within a UTC day, the 48-hour lifetime with a fake clock, the cover caching headers, and the access checks of uncached requests.
