# Masonry layout for the Recents grid

> Historical research, incorporated 2026-10-28. Cup adopted the recommended row spans on a CSS grid with 1 px rows, measured by a `ResizeObserver` over one newest-first list, with no `grid-lanes` path, through [spec #89](https://github.com/patricktree/cup/issues/89), built in [#101](https://github.com/patricktree/cup/pull/101) (`8cccf1e`) as [`useMasonryRowSpans`](../../apps/web-app/src/app/use-masonry-row-spans.ts); covers reserve their space with a fixed 5:3 crop. See [Recents](../architecture/web-app.md#recents). The revisit condition for `grid-lanes` below still applies. Repository observations below describe `dcec7ecd`.

[Original investigation](https://github.com/patricktree/cup/blob/9a8f475982ba867facd1008e57cc1b0f9c9606e0/docs/research/recents-masonry-layout.md).

Research date: 2026-10-27, for [issue #82](https://github.com/patricktree/cup/issues/82) of the [Recents redesign map](https://github.com/patricktree/cup/issues/79). Repository observations are from `main` at `dcec7ecd`. Browser support data is `@mdn/browser-compat-data` 8.1.7 and `web-features` 3.44.0, both published 2026-10-22. Specifications are the CSS Grid Level 3 Editor's Draft of 2026-10-21 and the CSS Multi-column Level 1 Editor's Draft of 2026-10-12. Chromium source is `main` at `223ff6fd` and Chrome Status was read on the research date. Measurements ran in Google Chrome 155.0.8059.85 (desktop stable) through Playwright 1.64.0. No WebKit engine was run and no device was used, so iOS behavior comes from the spec, release notes and compatibility data only. The [Figma design](https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=260-1395) was not opened (the Figma connection was not authorized); the card anatomy comes from the map's notes: title, optional cover image, source host below.

## Question

Which masonry technique lays out the Recents grid in two (or more, on wider screens) columns of unequal-height cards while keeping newest-first order left to right and top down, and works in iOS Safari, the Android WebView and desktop Chrome as of late 2026? Compare CSS `grid-lanes` (masonry), CSS multi-column and JavaScript placement, including infinite scroll appending pages, images loading after layout, keyboard and screen-reader reading order, and responsive column counts.

## Answer

- **`display: grid-lanes` cannot carry the layout yet.** It ships only in Safari, iOS Safari and `WKWebView` 26.4 and later (released 2026-03-24). Chrome, Chrome for Android and the Android WebView have it only behind the experimental web platform features flag, which app users cannot turn on, and Chrome Status lists no shipping milestone. Cup's iOS shell still deploys to iOS 15.
- **CSS multi-column fails the ordering requirement.** It fills the first column before the second, so the six newest of twelve cards stack in the left column, and appending a page rebalances the columns and moved half of the existing cards.
- **Recommended: JavaScript-measured row spans on a CSS grid.** A small hook measures each card with `ResizeObserver` and sets `grid-row-end: span N` on a grid with 1px rows; CSS auto-placement then puts every card in the shortest column. In Chrome 155 this matched greedy shortest-column placement exactly, kept the DOM in newest-first order, and left all existing cards in place when a page was appended. It needs only Baseline Widely available features (grid, `ResizeObserver`), so it behaves the same on all three targets.
- **Reading order holds for every technique that keeps one newest-first DOM list.** With shortest-column placement each card's top is at or below the previous card's top, so keyboard focus and screen readers, which follow the DOM, move down the page in newest-first order; no `reading-flow` is needed. Techniques that split the DOM into one container per column break this.
- **Every technique reshuffles when an earlier card changes height.** When the second-newest card grew by 120px (a cover image arriving late), 15 of 24 cards switched column, and 17 of 24 in Chrome's flagged `grid-lanes`. Cover images therefore need reserved space from known dimensions (`width` and `height` attributes) or a fixed crop, which ties into [issue #83](https://github.com/patricktree/cup/issues/83). Pending cards that become ready and newly added cards at the top reshuffle the grid the same way.
- **Responsive column counts stay in CSS.** `grid-template-columns` sets two columns on phones and more on wider screens; a width change changes card heights, and the observer updates the spans.
- **Revisit `grid-lanes`** once Chrome ships it and Cup's iOS floor reaches 26.4; the hook can then be deleted, because `grid-lanes` places items by the same rule plus a 1em tie tolerance.

The decision belongs to the [spec ticket](https://github.com/patricktree/cup/issues/86).

## Cup today

- The history route renders a plain `<ul>` of conversions from `useInfiniteQuery`, pages flattened in API order, with a "Load more" button ([`_shell.history.tsx`](https://github.com/patricktree/cup/blob/dcec7ecd98fa866818066b7d1efdb1a49eeb6456/apps/web-app/src/routes/_shell.history.tsx)). The query refetches every 5 seconds while any item is pending ([`account-history.ts`](../../apps/web-app/src/data-fetching/account-history.ts)), so card content, and with it card height, changes in place.
- History items carry no cover image yet; [issue #83](https://github.com/patricktree/cup/issues/83) researches where covers come from.
- The iOS shell's `IPHONEOS_DEPLOYMENT_TARGET` is 15.0 ([`project.pbxproj`](../../apps/mobile-app/ios/App/App.xcodeproj/project.pbxproj)). A `WKWebView` uses the WebKit of the installed iOS, so the shell sees every iOS version from 15 on. The Android shell's `minSdkVersion` is 24 ([`variables.gradle`](../../apps/mobile-app/android/variables.gradle)); its WebView is Chromium, updated through the Play Store on its own release train ([WebView FAQ](https://chromium.googlesource.com/chromium/src/+/223ff6fdfd17d58e64f4e10a6f6c248bf256c198/android_webview/docs/faq.md)).
- The web app's Playwright projects are `mobile-chromium` and `desktop-chromium` only ([`playwright.config.ts`](../../apps/web-app/playwright.config.ts)), so no automated test runs WebKit.
- The web app has no `ResizeObserver` or `IntersectionObserver` use yet.

## CSS `grid-lanes`

### What the spec says

[CSS Grid Layout Module Level 3](https://drafts.csswg.org/css-grid-3/) (Editor's Draft, 2026-10-21; last Working Draft 2026-01-21) defines `display: grid-lanes`. With `grid-template-columns` set, the inline axis is the grid axis: items form columns ("lanes") and stack in the block axis.

- **Placement (§4.4).** Items are placed in order-modified document order. Each auto-placed item goes into the lane with the smallest running position; lanes within the tie threshold of that position count as tied, and the first tied lane at or after the auto-placement cursor wins. The lane's running position then advances by the item's size plus the gap.
- **`fit-tolerance`** sets the tie threshold. Its initial value `normal` resolves to 1em in grid lanes layout; `infinite` fills lanes strictly in order. The property was renamed from `flow-tolerance`.
- **Stability.** Later items do not move earlier ones unless `dense` packing is on (§4.3, §4.4).
- **Reading order (§2.1, §4.3).** The draft warns that placement can appear to backtrack, recommends `reading-flow` for reordering in reading and linear navigation, and leaves open whether that should be the default.
- **Fallback (§9).** `display: grid;` followed by `display: grid-lanes;`: browsers without support keep a normal grid, which aligns rows and leaves gaps under shorter cards.

### Support on 2026-10-27

| Target                                      | `display: grid-lanes`        | Source                                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safari, iOS Safari, `WKWebView`             | 26.4+ (2026-03-24)           | BCD 8.1.7; [WebKit Features for Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/) (2026-03-24)                                                                       |
| `fit-tolerance` in WebKit                   | 26.4+, as `flow-tolerance`   | BCD 8.1.7 (`alternative_name`)                                                                                                                                                                  |
| Chrome, Chrome for Android, Android WebView | No; behind a flag            | BCD 8.1.7; [Chrome Status 5149560434589696](https://chromestatus.com/feature/5149560434589696); Chromium `runtime_enabled_features.json5` at `223ff6fd`: `CSSGridLanesLayout` is `experimental` |
| Firefox                                     | No                           | BCD 8.1.7                                                                                                                                                                                       |
| Baseline                                    | No (`grid-lanes` is `false`) | web-features 3.44.0                                                                                                                                                                             |

- The Chrome Status entry, last updated 2026-10-14, reads "No active development" for implementation status, lists a developer trial from desktop Chrome 140 and no shipping milestone, and notes that the implementation still lacks dense packing, subgrid, fragmentation and other parts.
- In Chrome 155.0.8059.85 stable, `CSS.supports("display", "grid-lanes")` is `false` by default and `true` with `--enable-experimental-web-platform-features`. With the flag, Chrome accepts `flow-tolerance` but not yet `fit-tolerance`, and placed cards exactly as a model of the spec algorithm with a 1em tie threshold predicts (see [Measurements](#measurements)).
- Apple reported that 79% of all iPhones that transacted on the App Store on 2026-06-07 ran iOS 26 ([App Store support](https://developer.apple.com/support/app-store/), read 2026-10-27), without a split by point release. The share below 26.4 is therefore unknown but was at least 21% in June.
- WebKit's own guidance ([When will CSS Grid Lanes arrive?](https://webkit.org/blog/17758/when-will-css-grid-lanes-arrive-how-long-until-we-can-use-it/), 2026-01-22) offers three paths: the CSS fallback above, a JavaScript polyfill loaded when `CSS.supports('display', 'grid-lanes')` is false, or not using Grid Lanes yet. It notes that grid lanes and multi-column differ in "the order of what comes into focus when tabbing through content". The `modern-web-guidance` `css-layout` guide (fetched 2026-10-27) advises not to ship native masonry "as a hard requirement until your Baseline target catches up"; its statement that no major browser supports grid lanes yet contradicts BCD and WebKit's release notes.

For Cup, `grid-lanes` alone would give Android and desktop Chrome a plain grid with row gaps, and iOS users below 26.4 the same.

## CSS multi-column

[CSS Multi-column Layout Level 1](https://drafts.csswg.org/css-multicol-1/) flows content through column boxes in the block direction: content that does not fit one column box continues in the next. With the initial [`column-fill: balance`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/column-fill), the browser shortens the columns to balance their lengths.

- **Order.** In Chrome 155, twelve newest-first cards in two columns landed as `000000111111`: cards 0–5 in the left column and 6–11 in the right. The second-newest card sits under the newest, not beside it, which contradicts "left to right, then top down".
- **Appending.** Adding a second page rebalanced the columns: 6 of the 12 first-page cards moved, all into the right column. Infinite scroll would make visible cards jump on every page.
- **Workarounds do not help.** Interleaving the DOM so that column-first flow looks row-first would make keyboard and screen-reader order differ from the visual order, and every append would change the interleaving.

Multi-column suits prose, not an ordered feed.

## JavaScript placement

All JavaScript techniques compute greedy shortest-column assignment: each card, in newest-first order, goes into the column whose bottom is highest. They differ in what owns the positions and the DOM order.

### Row spans on a CSS grid (recommended)

The grid has fixed column tracks, 1px implicit rows and no row gap. A hook measures each card's height and sets `grid-row-end: span ceil(height + gap)`. CSS Grid's default sparse auto-placement ([CSS Grid 1 §8.5](https://drafts.csswg.org/css-grid-1/#auto-placement-algo)) scans forward from the previous item's position for the first free area, which, because every column's bottom only grows, is the start of the shortest column (leftmost on a tie).

```css
.recents {
  display: grid;
  /* more columns from a container or media query */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: 1px;
  column-gap: var(--gap);
}
.recents > li {
  align-self: start; /* never stretch to the spanned rows, or the measured height feeds back */
}
```

```ts
// per card; the gap between cards is folded into the span
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const height = entry.borderBoxSize[0].blockSize;
    (entry.target as HTMLElement).style.gridRowEnd = `span ${Math.ceil(height + gap)}`;
  }
});
```

- **Measured.** In Chrome 155 the row-span grid matched the shortest-column reference at every step, moved none of the 12 first-page cards when a second page was appended, and re-placed cards exactly like the reference after a late resize.
- **Order.** The DOM stays one `<ul>` in newest-first order. Placement never puts a card above its predecessor, so focus order and screen-reader order follow the visual top-down order ([WCAG 2.2 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html), [Meaningful Sequence](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html)).
- **Before and without the hook.** `ResizeObserver` delivers its first observation in the same rendering update, before paint, so the first painted frame is already placed. If the script fails, cards in 1px rows overlap; applying `grid-auto-rows: 1px` only while the hook is active (for example through a data attribute) leaves an ordinary grid with row gaps instead.
- **Limits.** `align-self: start` is required: a stretched card would grow to its spanned area, the observer would see the larger height, and the span would grow on every round. Heights round up to whole pixels. Chrome 155 placed an item at row 2,000,000 of 1px rows without clamping; WebKit's track limit was not checked, and Cup's history stays far below it (a few hundred cards of about 300px over two columns is under 100,000 rows). A coarser row unit, e.g. 4px, lowers the row count at the cost of up to 4px extra gap per card.
- **Responsive columns.** `grid-template-columns` changes with a container or media query; narrower or wider columns change card heights, the observer fires, and the spans follow. Nothing in JavaScript knows the column count.

### Absolutely positioned cards

[Masonry.js](https://www.npmjs.com/package/masonry-layout) (4.2.2, last published 2018-07-04), the polyfill WebKit's article names, and [masonic](https://www.npmjs.com/package/masonic) (4.1.0, 2025-04-22, virtualized) compute `top` and `left` for every card and set the container height. The DOM order can stay newest-first, so reading order is as good as with row spans. JavaScript must also own the column count, the gaps and every re-layout on resize, which row spans leave to CSS. Virtualization only pays off for lists far longer than Cup's history.

### One container per column

[react-masonry-css](https://www.npmjs.com/package/react-masonry-css) (1.0.16, 2021-04-04) and similar components distribute items into one flex column per column, round-robin; its README lists "Sorting based on height" under what it does not do. The DOM then reads down the first column before the second, so keyboard and screen-reader order skip between distant cards, and unequal heights let one column run far longer than the other. A height-aware variant fixes the balance but not the DOM order.

## Height changes after layout

Shortest-column placement depends on the heights of all earlier cards, so any height change re-places the cards after it. This is inherent to the layout, native or scripted.

- **Late images.** When the second-newest card grew by 120px, 15 of 24 cards switched column with row spans (the same as the reference) and 17 of 24 with Chrome's flagged `grid-lanes` (15 with a zero tie threshold). Reserving space removes this: `<img width height>` gives the image its aspect ratio before it loads (Baseline Widely available; iOS Safari and `WKWebView` from 15), and `aspect-ratio` with `object-fit: cover` crops to a fixed ratio. Either way the card height is final at first layout only if the history API returns cover dimensions or the design crops to a fixed ratio; [issue #83](https://github.com/patricktree/cup/issues/83) should cover which.
- **Scroll position.** Scroll anchoring (`overflow-anchor`) keeps the viewport steady when content above it changes height in Chrome and the Android WebView (56+), but only from iOS Safari and `WKWebView` 27 (BCD 8.1.7). On earlier iOS, a height change above the viewport moves what the reader sees.
- **Status changes.** A pending card that becomes ready gains a title and possibly a cover; the 5-second refetch applies such changes while the reader looks at the top of the grid. A card for a newly added conversion is inserted first and re-places every card after it. Whether pending cards reserve the height of a ready card, or whether the reshuffle is accepted, is a design question for the spec.
- **Fonts.** A web font that loads after first layout changes title heights the same way; the observer re-places cards automatically.

## Infinite scroll

With row spans, `grid-lanes` and absolute positioning, appended cards are placed after the existing ones and existing cards stay where they are, as long as nothing earlier changes height (0 of 12 moved in the measurement). A sentinel element after the grid, watched by `IntersectionObserver` (iOS from 12.2), can request the next page; the grid's end is the bottom of its longest column, so the sentinel fires when the reader nears the end of the longer column, while the shorter column has already ended. Multi-column moves existing cards on every append.

## Recommendation

Use the row-span grid on all targets: one newest-first `<ul>`, one hook that keeps spans in sync through `ResizeObserver`, column counts in CSS, reserved image space, and no multi-column. Do not add a `@supports (display: grid-lanes)` path for iOS 26.4+ now: it would run a second placement rule (with its 1em tie tolerance, set `flow-tolerance: 0` to match) on a platform no automated test covers, to save a hook that is small anyway. Replace the hook with `display: grid-lanes` once Chrome and the Android WebView ship it and Cup's supported iOS versions all have it; [Chrome Status](https://chromestatus.com/feature/5149560434589696) is the signal to watch.

## Measurements

The [research archive](recents-masonry-layout.tar.xz) contains the scripts and their outputs. `masonry-experiment.mjs` builds four 360px-wide, two-column containers in Google Chrome (multi-column, row-span grid, `grid-lanes` with default tolerance, `grid-lanes` with zero tolerance), adds 12 cards of deterministic heights between 80 and 300px, appends 12 more, then grows the second card by 120px. After each step it prints each card's column as a string of `0` (left) and `1` (right) next to two references: greedy shortest-column placement, and the spec's placement with a 1em tie threshold. `supports.mjs` reports which grid-lanes declarations Chrome accepts with the flag, and `track-limit.mjs` places items at increasing 1px row numbers.

Results in Chrome 155.0.8059.85:

| Container             | First page     | After append: first-page cards moved | After late resize: cards that switched column |
| --------------------- | -------------- | ------------------------------------ | --------------------------------------------- |
| Shortest-column model | `011100110101` | 0 of 12                              | 15 of 24                                      |
| Row-span grid         | `011100110101` | 0 of 12                              | 15 of 24                                      |
| Multi-column          | `000000111111` | 6 of 12                              | 0 of 24 (still column-first)                  |
| `grid-lanes`, no flag | `010101010101` | 0 of 12 (plain grid fallback)        | 0 of 24 (plain grid fallback)                 |
| `grid-lanes`, flag    | `011101001010` | 0 of 12                              | 17 of 24                                      |
| `grid-lanes`, flag, 0 | `011100110101` | 0 of 12                              | 15 of 24                                      |

Without the flag both `grid-lanes` containers fall back to a plain grid (`display: grid` declared first), alternating columns row by row. With the flag, default tolerance matches the 1em spec model and zero tolerance matches the shortest-column model. The cards are fixed-height boxes, not real cards with text and images.

```sh
tar -xJf docs/research/recents-masonry-layout.tar.xz -C /tmp
node /tmp/recents-masonry-layout/masonry-experiment.mjs "$(pwd)/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright"
node /tmp/recents-masonry-layout/masonry-experiment.mjs "$(pwd)/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright" --experimental
```

The scripts take the path to an installed `playwright` package and launch the locally installed Google Chrome (`channel: "chrome"`).

## Limits

- No WebKit engine ran. The iOS conclusions rest on BCD, WebKit's release notes and the spec; neither the row-span grid nor `grid-lanes` was observed in Safari or a `WKWebView`. The row-span technique uses only CSS Grid Level 1 auto-placement, which WebKit implements, but a device check belongs in the build.
- Desktop Chrome stands in for the Android WebView, which shares the Chromium engine but was not run.
- The experiment used boxes with fixed heights; real cards add text wrapping, font loading and image decoding.
- The Figma design was not inspected, so whether cover images keep their natural aspect ratio or are cropped is open.
