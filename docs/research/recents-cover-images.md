# Cover images on Recents cards

> Historical research, incorporated 2026-10-28. Adopted as [ADR 0013](../adr/0013-cache-cover-images-in-the-browser-for-a-day.md), built in [#101](https://github.com/patricktree/cup/pull/101); see [Recents covers and order](../architecture/web-app.md#recents-covers-and-order). Cup differs from the recommendations below: the issue time rounds to the UTC day, not the hour; covers crop to 5:3, not 1.91:1; the card rendition is unbuilt ([#90](https://github.com/patricktree/cup/issues/90)). Repository observations below describe `dcec7ecd`.

[Original investigation](https://github.com/patricktree/cup/blob/87904fc6059ccdf8da4f86534271557fcc36abfc/docs/research/recents-cover-images.md).

Research date: 2026-10-27, for [issue #83](https://github.com/patricktree/cup/issues/83) of the [Recents and detail view map](https://github.com/patricktree/cup/issues/79). Repository observations are from `origin/main` at `dcec7ecd`. Measurements ran on an Apple Silicon Mac with Node 24.18.0 and Chrome for Testing 153.0.8010.12 (Playwright's Chromium build); WebKit, workerd and phones were not measured. Cloudflare documentation was read on the research date. The decision belongs to the later spec ticket; this page only recommends.

## Question

History items carry only `hasCoverImage`, while the audiobook response carries a [signed media URL](../architecture/authentication.md#signed-media-url) for the cover. How should Recents cards get their cover images? The ticket asks for the cost of signing one URL per history item, how signed URLs interact with browser and React Query caching across history polls, the stored cover images' dimensions and byte sizes, and whether cards need a smaller rendition.

## Answer

- **Signing is cheap.** One signed URL costs about 16 µs of CPU in Node (one HMAC-SHA-256 plus a key import), under 1 ms for a full 50-item history page, and adds about 360 characters per item.
- **Serving is the real cost, and fresh tokens multiply it.** Every response mints a new token, so every history poll (every 5 s while an item is pending) and every remount of the Recents screen (`staleTime: 0`, `gcTime: 0`) hands each card a new `src`. Chromium then fetches every visible cover again; an unchanged URL is never refetched within the page, even with `Cache-Control: private, no-store`. Each fetch is a full Worker request with four Durable Object calls and two R2 reads, including the audiobook manifest.
- **Stored covers are publisher originals, unchanged.** They are capped at 10 MiB, with no dimension limit, as JPEG, PNG, WebP, AVIF or GIF (animation kept). A sample of 27 current article `og:image`s had a median of 1200×630 px and 96 KB, a 75th percentile of 193 KB and a maximum of 1 MB.
- **A card rendition pays off.** A two-column phone card needs roughly 500–640 px of width. Downscaled to 640 px wide WebP, the same sample had a median of 20 KB (about 5× smaller) and decodes to about a quarter of the pixels.
- **Cards must reserve the cover's height before it loads**, or each loading cover reflows the masonry grid. Nothing records cover dimensions today. A fixed-ratio crop (about 1.91:1, `object-fit: cover`) needs no data; carrying width and height means recording them at storage time and adding ledger columns, manifest and response fields.
- **Recommendation for the spec:** sign a cover URL into each ready history item that has a cover, and make the URL stable across polls by bucketing the token's issue time. Show covers on cards in a fixed-ratio box unless the design wants each cover's own shape. Produce one card rendition per audiobook once, when the cover is stored, with the Cloudflare Images binding, and fall back to the original where it cannot be made. Check the shells separately: the media routes' `Cross-Origin-Resource-Policy: same-origin` likely blocks a cover `<img>` in the Capacitor WebViews.

## How covers reach clients today

- The audiobook response signs two URLs with one `issuedAtMs`: the narration track and `coverImage.url` ([`api-server.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/api-server/src/api-server.ts#L658-L667)). [`signMediaUrl`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/api-server/src/http/signed-media-url.ts#L26-L61) encodes `{ conversionId, principal, expiresAtMs }` as base64url JSON, signs it with HMAC-SHA-256, and appends `token=v1.<payload>.<signature>`. It imports the signing key on every call. Because the payload carries the issue time to the millisecond, two responses never produce the same URL.
- The history route returns `hasCoverImage` only ([`historyItemSchema`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/listener-api.routes/src/contracts.ts#L253-L269), [`toAccountHistoryResponse`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/api-server/src/http/listener-responses.ts#L57-L83)). The account ledger stores that flag ([`account-sqlite-schema.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/accounts/src/storage/account-sqlite-schema.ts#L45)); alternative text exists only in the manifest. A page holds up to 50 items ([`account-sqlite.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/accounts/src/storage/account-sqlite.ts#L443-L459)).
- No screen renders the cover yet. The only consumer is the player's `navigator.mediaSession` artwork ([`player-host.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/apps/web-app/src/app/player/player-host.ts#L240-L243)).
- The web CSP allows `img-src 'self'` ([`api-server.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/api-server/src/api-server.ts#L1250-L1266)), which covers same-origin cover URLs on the web.

## Cost of signing one URL per history item

A Node script that mirrors `signMediaUrl` (key import per call, HMAC-SHA-256, base64url, `URL` building) measured 16 µs per URL, or 0.8 ms for 50 URLs. With the key imported once and reused, it took 9.5 µs per URL. Each URL is 361 characters, so a full page grows by about 18 KB before compression. Node's Web Crypto stands in for workerd's here; both call native HMAC code, so the order of magnitude should hold, but workerd was not measured.

The token must name its audiobook, so a page needs one HMAC per item with a cover; there is no shared token for a page. At these numbers, signing is negligible next to the Durable Object call the history request already makes.

## Cost of serving one cover request

Every cover request runs through the media middleware and then [`serveCoverImage`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/api-server/src/http/serve-audiobook.ts#L119-L153):

1. The middleware looks up the owner in the registry Durable Object, verifies the token, and calls the account's (or grant's) Durable Object `inspect()` ([`api-server.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/api-server/src/api-server.ts#L1380-L1406), [`signed-media-url.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/api-server/src/http/signed-media-url.ts#L99-L133)).
2. The handler looks up the owner in the registry again, reads the ready audiobook reference from the owner's Durable Object, then reads and parses the whole manifest from R2 to confirm a cover is recorded. The manifest holds the narration document, bounded by 40,000 narration characters ([`run-prepare-audiobook-workflow.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/create-audiobook-from-url-workflow/src/run-prepare-audiobook-workflow.ts#L78-L79)).
3. It reads the cover object from R2 and streams it with `ETag` and, through the default middleware, `Cache-Control: private, no-store`. A matching `If-None-Match` answers `304`, but a browser that may not store the response has nothing to revalidate.

That is four Durable Object calls and two R2 reads per image. A Recents screen with 20 visible covers therefore costs 80 Durable Object calls and 40 R2 reads on each load. The owner's records already carry `hasCoverImage`, so the manifest read is avoidable; that is an optimization independent of this decision.

## Signed URLs, React Query and the browser

**React Query.** The history query is an infinite query that polls every 5 s while any item is `pending` ([`account-history.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/apps/web-app/src/data-fetching/account-history.ts#L9-L27)), and a refetch requests every loaded page in order, starting from the first ([TanStack infinite queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)). The client defaults are `staleTime: 0` and `gcTime: 0` ([`query-client.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/apps/web-app/src/data-fetching/query-client.ts#L46-L57)), so leaving Recents drops the cache and returning refetches. Structural sharing keeps unchanged parts of the data and replaces only what differs ([TanStack render optimizations](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations)). With a fresh token per response, every item that has a cover differs on every poll, so every card re-renders with a new `src`. The reader's audiobook query polls every 1 s while pending or synthesizing ([`reader.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/apps/web-app/src/data-fetching/reader.ts#L13-L25)), so a cover on the detail view would change its URL every second during synthesis.

**The browser.** The HTML standard keeps a per-document list of available images, "to avoid re-downloading images in the same document even when they don't allow caching per HTTP" ([HTML, images](https://html.spec.whatwg.org/multipage/images.html#list-of-available-images)). When `src` changes on an image that is already shown, the new load becomes the pending request and the old image stays until the new one arrives ([update the image data](https://html.spec.whatwg.org/multipage/images.html#update-the-image-data)), so changing tokens should not make covers flicker, but they are downloaded again.

A Chromium experiment confirmed this with Cup's headers (`img-cache-experiment.mjs` in the archive):

| Step                             | `private, no-store` requests | `private, max-age=3600` requests |
| -------------------------------- | ---------------------------- | -------------------------------- |
| First render, token A            | 1                            | 1                                |
| Same element, same URL set again | 0                            | 0                                |
| New element (remount), same URL  | 0                            | 0                                |
| Same element, new token B        | 1                            | 1                                |
| New element, earlier URL A       | 0                            | 0                                |
| After a page reload, URL A       | 1                            | 0                                |

So, within one page, the URL decides: an unchanged URL costs nothing even with `no-store`, and every new token costs a full download. The HTTP cache matters only across reloads and app restarts, and only if the URL is still the same. WebKit was not tested; the standard requires the same behavior.

**What that means for Recents.** With today's tokens, each 5 s poll re-downloads every cover the browser has loaded, and every return to Recents re-downloads them all. For example, 20 loaded covers of median size during a two-minute preparation make 24 polls × 20 × 96 KB ≈ 46 MB on a phone, plus 480 Worker requests. The map adds a synthesizing state to cards; if the spec polls during synthesis too, the window grows to the synthesis time.

**Making URLs stable.** Options, from least to most change:

- **Bucket the issue time on the server (recommended).** Sign with `issuedAtMs` rounded down to the hour, keeping the 24-hour expiry from the rounded time. The same principal then gets byte-identical URLs for an hour, so structural sharing keeps the old string, React leaves `src` alone, and the list of available images serves remounts. Remaining lifetime at issue becomes 23–24 hours, which still leaves the player's renewal rule (renew after 12 hours, measured from receipt) its margin. It changes one function and fixes the history and reader polls alike. A bucketed URL is identical for an hour after a sign-out on the same device; [#60](https://github.com/patricktree/cup/issues/60) already accepts that local sign-out leaves URLs valid.
- **Keep URLs on the client.** Remember the first cover URL per conversion outside React Query, the way the player remembers when it received the track URL, and replace it after 12 hours. This works without server changes but adds client state that `gcTime: 0` otherwise avoids, and every surface needs it.
- **Allow private browser caching.** With stable URLs, the cover route could send `Cache-Control: private, max-age=…` so reloads and app restarts reuse the image. A cache hit sends no request, so the authoritative checks of [ADR 0007](../adr/0007-require-active-grant-access-for-trial-audiobooks.md) would not run for it; that resembles #60's "bytes already downloaded can't be retracted" but is a policy choice for the spec. Bucketing alone already removes the poll and remount downloads.

Cloudflare's [Workers Cache](https://developers.cloudflare.com/images/optimization/binding/) serves cached responses "without re-running your Worker", which would skip the signature and access checks, so it does not fit private media routes. The [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) can be used after the checks, keyed without the token, but it is per data center and `put` refuses responses whose `Cache-Control` forbids caching.

## Stored cover images: limits and observed sizes

Preparation keeps the image the source page declares (Open Graph before Twitter) and stores it unchanged ([conversion: cover image](../architecture/conversion.md#cover-image), [`store-cover-image.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/audiobook-production/src/store-cover-image.ts)). [`loadCoverImage`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/prepare-source-material/src/load-cover-image.ts) limits it as follows:

- at most 10 MiB (`MAX_COVER_IMAGE_BYTES`), checked against `Content-Length` and the received bytes;
- JPEG, PNG, WebP, AVIF or GIF, identified from the leading bytes; SVG refused;
- no limit on pixel dimensions, and animation is kept ("a surface decides how to show it").

No production covers were read for this research, and the local development bucket held none. Instead, `og-sample.mjs` took two recent articles from each of 15 publisher front pages (The Guardian, Ars Technica, The Verge, Wired, The New Yorker, Quanta, Aeon, the Cloudflare blog, the GitHub blog, NPR, Vox, TechCrunch, Der Spiegel, heise and Astral Codex Ten), extracted each declared image as Cup does, and requested it with Cup's `Accept` header. Of the 30 pages, 27 declared an image. Two picks were section pages rather than articles, and the sample leans towards large news publishers.

| Measure | Minimum | 25th percentile | Median  | 75th percentile | Maximum  |
| ------- | ------- | --------------- | ------- | --------------- | -------- |
| Bytes   | 5 KB    | 58 KB           | 96 KB   | 193 KB          | 1,013 KB |
| Width   | 468 px  | 1200 px         | 1200 px | 1200 px         | 1400 px  |
| Height  | 410 px  | 624 px          | 630 px  | 720 px          | 1200 px  |

Formats: 14 WebP (negotiated by the `Accept` header), 10 JPEG, 2 PNG and 1 GIF. Almost all are landscape at about 1.9:1, the Open Graph link-preview shape; one was portrait (800×1200) and one nearly square.

## Is a smaller card rendition needed?

The map calls for a mobile-first two-column masonry. On a 390 px wide phone with 16 px gutters and a 12 px gap, a card is about 170 CSS px wide, about 510 device pixels at 3× density; wider screens add columns rather than widening cards. The Figma frames were not read (the Figma connector was not authorized), so these widths are assumptions. A typical 1200 px original carries about 5× the pixels such a card shows.

`rendition-estimate.mjs` downscaled each sampled image in Chromium's canvas and encoded WebP at quality 0.8:

| Rendition         | Median | Sum for 27 images |
| ----------------- | ------ | ----------------- |
| Original          | 96 KB  | 4.07 MB           |
| WebP, 640 px wide | 20 KB  | 0.78 MB           |
| WebP, 480 px wide | 12 KB  | 0.45 MB           |

Decoded size scales with pixels: a 1200×630 bitmap takes about 3 MB of memory, a 640×336 one about 0.9 MB. With 50 cards loaded by infinite scroll, that is roughly 150 MB against 43 MB at worst; browsers may discard decoded images off screen.

A rendition is therefore worth it for data and memory on phones, but it is not required for correctness: lazy loading (`loading="lazy"`) plus stable URLs already removes most of the waste. Originals stay right for the detail view and the system media artwork.

## How a card rendition could be produced

**At storage time, with the Images binding (recommended).** In the existing "store cover image" workflow step, after storing the original, transform the same bytes once and store the result as a second object beside `cover-image`, recorded in the manifest. The [Images binding](https://developers.cloudflare.com/images/transform-images/bindings/) takes a stream through `.input()`, applies `.transform({ width, fit })`, and needs an explicit `.output({ format, quality, anim })`; `anim: false` would freeze an animated GIF on its first frame. It runs on the Images Free plan: "5,000 unique transformations each month for free", then $0.50 per 1,000, and each unique source and parameter combination counts once per calendar month ([pricing](https://developers.cloudflare.com/images/pricing/)). One transformation per audiobook keeps Cup inside the free tier until 5,000 conversions a month.

Limits that shape the fallback ([limits and formats](https://developers.cloudflare.com/images/get-started/limits/)):

- `.input()` accepts up to 20 MB, above Cup's 10 MiB cap.
- AVIF input needs an Enterprise plan, so AVIF originals cannot be resized and would keep serving the original.
- Images are limited to 100 megapixels; animations over 50 megapixels are delivered untransformed.
- `wrangler dev` and Vitest run a low-fidelity local version that supports only `width`, `height`, `rotate` and `format`; that suffices for a resize to WebP.

A failed transformation should leave the audiobook with only its original, as a failed cover fetch leaves it without one: best-effort, logged, never failing the conversion. Audiobooks stored before the change have no rendition; with no users yet, backfilling is unnecessary. The binding adds a new external dependency and a Wrangler `images` binding, which the [Cloudflare guidance](../agents/cloudflare.md) and production configuration would need to list.

**On request, with the Images binding and the Cache API.** Transform in the cover route after authorization and cache the result under a key without the token. Billing is the same, but each data center caches separately, the first request per data center pays the transformation latency, and the route gains a cache to invalidate on erasure. Producing the rendition once at storage time is simpler and fits immutable, erasable artifacts.

**No rendition.** Serve originals with lazy loading and stable URLs. This is the smallest change and acceptable while lists are short; it costs about 5× the data and 4× the decoded memory per card.

## Reserving space before covers load

Added on 2026-10-27 at the map coordinator's request. The masonry research for the same map recommends a CSS grid with 1 px rows, where a `ResizeObserver` sets each card's row span; there, a card that changes height after layout moves later cards to other columns (a 120 px growth of the second-newest card moved 15 of 24 cards). An `<img>` without reserved space starts at zero height and grows when it loads, so every cover would trigger that reflow, once per card and again whenever a new token makes the image reload into a box sized by its predecessor's ratio. The card's image box needs its final height before the bytes arrive.

The sample shows how much heights would vary if cards kept each cover's own shape. Width÷height ratios were 1.5–1.93 for 25 of 27 covers (22 of them between 1.78 and 1.93, mostly 16:9 and the Open Graph 1.91:1), plus 0.67 (portrait) and 0.98 (square). In a 170 px wide card that is 88–113 px for the typical covers, 173 px for the square and 254 px for the portrait.

Two ways to know the height before loading:

- **Carry the cover's width and height (or its ratio).** The client sets `<img width height>` or `aspect-ratio` from the response, and each card keeps its cover's shape. Dimensions are not recorded today. Preparation must read them when it stores the cover: the Images binding's `.info()` returns `width` and `height` and is free, or a small header parser can read them (the archive's `og-sample.mjs` does so for all five formats in about 40 lines). They must then travel to every surface: a manifest field for the reader, and new columns in the account ledger (a migration), because history reads the ledger, not the manifest. History, the audiobook response and the OpenAPI snapshot grow a field. Audiobooks stored before the change have no dimensions and need a fallback ratio. A rendition's dimensions follow from the original's.
- **Fixed-ratio crop.** A card has a cover box of one fixed ratio whenever `hasCoverImage` is true, so `hasCoverImage` alone determines the height. Nothing in the data, the ledger or the contracts changes. CSS `aspect-ratio` plus `object-fit: cover` crops on the client. Covers far from the chosen ratio lose content: at 1.91:1, the 0.98 cover loses about half its height and the portrait one about two thirds. A server-made card rendition could crop instead, with `fit: "cover"` and `gravity: "auto"`, which picks the crop by a saliency algorithm ([features](https://developers.cloudflare.com/images/optimization/features/)); AVIF originals would still be cropped by CSS.

A middle path carries the ratio but clamps it, for example to between 1:1 and 2:1, so outliers are cropped and typical covers keep their shape; it has the first approach's recording and migration costs.

Either approach also needs the box to stay put while a new URL loads. Stable URLs (see above) avoid reloads; with a fixed ratio or recorded dimensions, a reload cannot change the box anyway.

**Recommendation.** Use a fixed-ratio crop on cards, at the Open Graph ratio of about 1.91:1, which 13 of the 27 sampled covers match within 0.02; another 9 are 16:9 and lose about 7% of their height. (A 16:9 box is the mirror choice: it trims about 7% of the width of 1.91:1 covers.) It removes cover-driven reflow with no contract, ledger or migration change, and masonry still varies by title length and by whether a card has a cover. Choose recorded dimensions instead if the Figma design shows covers in their own shape; then record them when the cover is stored and add them to the ledger, the manifest and both responses. This ticket did not read the Figma frames, so the spec should check which the design intends.

## Capacitor shells

The Capacitor shells load the web app from `https://localhost` (Android) or `capacitor://localhost` (iOS) and call the API at `https://cup.audio` ([`api-origin.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/apps/web-app/src/platform/api-origin.ts)). A cover `<img>` without `crossorigin` is a `no-cors` request, and the media routes answer with `Cross-Origin-Resource-Policy: same-origin` ([`api-server.ts`](https://github.com/patricktree/cup/blob/dcec7ecd/libs/api-server/src/api-server.ts#L1404)), which tells browsers to block cross-origin `no-cors` requests ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy)). Covers on Recents cards therefore likely fail to load in both shells. This was not tested in a WebView. The fix is a header choice on the cover route (for example `cross-origin`, since the signed URL is the authorization) that the spec or a separate ticket should settle; the narration track has the same header.

## Unknowns and limits

- Signing was measured in Node, not workerd; WebKit's image cache was not tested; nothing ran on a phone.
- The cover sample is 27 images from 15 mostly large publishers on one day. Blogs, newsletters and smaller sites may declare smaller, larger or square images.
- Rendition sizes come from Chromium's WebP encoder, not Cloudflare's; expect similar magnitudes, not equal bytes.
- Card widths are assumptions until the spec reads the Figma frames.
- The CORP effect in the shells is inferred from the header and the standard, not observed.

## Reproduction

The [experiment archive](recents-cover-images.tar.xz) holds the scripts and their outputs. `sign-bench.mjs` runs with plain Node. `img-cache-experiment.mjs` and `rendition-estimate.mjs` import `playwright-core` from the main checkout's `node_modules` and launch an installed Chrome for Testing by absolute path; adjust both paths to rerun them. `og-sample.mjs` takes publisher front-page URLs as arguments, and `rendition-estimate.mjs` takes `og-sample.mjs`'s output file. Image bytes stay in memory and are not part of the archive.
