# iOS Safari cutting the snapshot of a stuck element

> 2026-10-30, after this page was written: the minimal page was run again on Mobile Safari on the iOS 26.3 simulator, on the first two untested predictions below. With the name on an inner element and the outer element kept `position: sticky`, the whole bar faded in at a scroll of 50px and of 600px, so option 2 works there. It has not been tried in Cup, or on a device. A stuck `position: sticky; top: 0` header with its own name, as the new snapshot at a scroll of 600px, did not show at all, which confirms the predicted header gap. In Cup that header is only on the detail view, which transitions in at the top of the page, so the gap would need a forward navigation to a scrolled detail view; that case was not run.

Research date: 2026-10-30. Sources are the WebKit source at [`main` commit `a82d5c7`][wk-main] (325258@main, committed 2026-10-30) and tag [`WebKit-7623.1.14.14.9`][wk-7623] (committed 2025-11-15), the newest 7623 tag in the repository; CSS View Transitions [Level 1][vt1] (Editor's Draft, 2025-02-16) and [Level 2][vt2] (Editor's Draft, 2026-08-31), both searched in full for sticky and read at the capture sections; the trackers named below; web-platform-tests at [`3a45943`][wpt-tree]; and `@mdn/browser-compat-data` 8.1.7 (2026-10-22). Repository observations describe commit [`a422570`][cup-commit]. **This investigation ran no browser, device or simulator.** Every measurement below was taken by the project on 2026-10-30 and handed to this research. Everything marked as an inference or a prediction is untested, and which tag a given iOS release ships was not established.

## Question

On iOS Safari, during a same-document View Transition, why is the snapshot of a stuck `position: sticky; bottom: 0` element with its own `view-transition-name` cut by an amount that grows with the page's scroll position? Is this known, is it specified, and is [our workaround][cup-fade-footer] (fixed bars during the transition, plus a [400px grid row][cup-shell]) the best available?

## Answer

- **Is it known?** No report of this behaviour was found. The closest entry is [WebKit 299578][wk-bug-299578], which fixed the same fault for captured `position: fixed` elements and did not touch the sticky path. Safari's [26.2 release notes][safari-26-2] describe that fix (radar 154886047) as covering both fixed and sticky content, which the [diff][wk-3c71d5e] does not bear out, and [`WebKit-7623.1.14.14.9`][wk-7623-sublayers] and `main` have the same order of checks.
- **Cause, from the source, unconfirmed at runtime:** on Liquid Glass builds a stuck element in the main frame gets a viewport-sized clipping layer whose position is the layout viewport's origin in document coordinates. When the element is captured as a new snapshot, that layer is moved into `::view-transition-new`, whose coordinates start at the bar, and it keeps its position. So the window onto the bar starts S pixels into it, for a scroll of S. This predicts the amounts measured, including "whole at 0" and "nothing at 600". It does not settle which side of the bar is cut (see [the measurements](#the-measurements-against-the-code)).
- **The handed-over hypothesis is half right.** A stale rect in the web process is contradicted: a programmatic scroll updates the rect at once. The clip doesn't need any staleness to cut. The UI process's scrolling tree does own a lagging copy of the viewport, and that lag may decide which side is cut, but that was not shown.
- **Why not Linux?** The clipping layer needs the `ContentInsetBackgroundFill` setting, which [defaults to false off Cocoa][wk-pref-default-other]. This is read directly from the source, and it applies to any non-Cocoa WebKit.
- **Specified?** Neither level mentions sticky. A stuck bar inside the viewport being cut goes against capture's minimum content in [Level 1, 7.7.1][vt1-rendering], so our reading is that it is a WebKit bug.
- **Is (a) the best available?** It is the best one that has been tested, and now it has an explanation: it switches to the one path WebKit already fixed. It is probably not the best design. Naming an inner element should avoid the clipping layer and keep the bars sticky with no 400px row, and it needs one simulator run to find out. **Recommendation: keep (a) for now, run the tests in [what to run next](#what-to-run-next), and replace (a) with an inner name if it passes.**

Ranked for Cup, best first. Only rank 1 has been run on an affected browser, and only at a scroll of 600px.

| Rank | Option                                                      | Evidence                                           | Keeps bars sticky | Main cost                                                                              |
| ---- | ----------------------------------------------------------- | -------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| 1    | (a) Shipped: fixed during the transition, plus a 400px row  | **Tested** at 600px on the iOS 26.3 simulator      | No                | A transition-only layout switch and a magic row height; the header stays uncovered     |
| 2    | (c) Name an inner element, not the sticky one               | Source reading, **untested**                       | Yes               | One wrapper per bar, and the fade moves onto it                                        |
| 3    | (c) `overflow: clip` on `::view-transition-new(bottom-bar)` | Source and a WPT for the path, **untested** here   | Yes               | Clips the bar's fade during the transition; repaints every frame                       |
| 4    | (b) Bars always fixed, with a reserved row of known height  | Fixed geometry tested; the always-fixed layout not | No                | Each bar must publish its height; a structural change for the same browser path as (a) |
| 5    | (c) Compositing an ancestor during the transition           | Source inference, **untested**                     | Yes               | A page-sized layer, and it relies on a side effect                                     |
| None | Scroll timing, `contain`, hints on the bar, sniffing        | See [workarounds](#workarounds)                    | n/a               | They don't reach the cause, or they can't detect it                                    |

## The reproduction

The minimal page is a grid shell with `min-height: 100dvh` and `isolation: isolate`, holding a main area and a `position: sticky; bottom: 0` bar in the last row. A list screen has a 110px bar and 40 cards. A detail screen has a `position: sticky; top: 0` header, a 3000px card and a 144px bar. `:root` has `view-transition-name: none`, and while `:active-view-transition` matches, the bar, the header and each screen's main area carry names. The old and new bar pseudo-elements are aligned to the bottom of their group, as in [Cup's global styles][cup-global-styles], and every animation lasts 1000ms.

The script scrolls the list to S, calls `startViewTransition` to swap to the detail screen and scroll to 0, waits, then calls `startViewTransition` to swap back and `window.scrollTo(0, S)` inside the update callback. It logs the bar's `getBoundingClientRect()` and the computed `transform` of `::view-transition-group(bottom-bar)` at `ready`. A variant sets `position: fixed; inset-inline: 0; bottom: 0` on the bar during the transition and a 400px last row on the shell.

## The mechanism in the source

The links below separate into what the code does, which is read directly, and what follows for this bug, which is inference.

**A sticky element gets the clipping layer, also while captured.** [`viewportConstrainedSublayers`][wk-sublayers] handles sticky elements first, returning the [clipping and anchor layers][wk-sublayers-gate] when the setting is on, the frame is the main frame, and the compositing ancestor is the render view. Only after that branch does it [return none for a captured element][wk-sublayers-captured], and that check sits on the fixed path. [Commit `3c71d5e`][wk-3c71d5e] added that check, and it fixed tests that are all either massive elements or fixed-position content.

**The layer is a real clip.** The clipping layer is created with [`setMasksToBounds(true)`][wk-clip-create]. [Commit `27e72ea`][wk-27e72ea] introduced it in 2025-05, to clip fixed elements and sticky elements outside overflow scrollers in the main frame to the viewport, and made it depend on the `ContentInsetBackgroundFill` setting.

**The geometry assumes document coordinates.** [`updateGeometry`][wk-geometry] sets the clipping layer's position and size to `rectForFixedPositionLayout()` and subtracts the same origin from the anchor layer's position. For a captured element, the [same function][wk-geometry-capture] first replaces the parent rect with the element's own, so the primary layer lands at about 0 in the pseudo-element's coordinates.

**The new snapshot is that layer tree.** [`collectViewTransitionNewContentLayers`][wk-collect] parents [`childForSuperlayersExcludingViewTransitions`][wk-child-for-superlayers] into `::view-transition-new`, and that function returns the clipping layer when there is one. Whenever [`canUseExistingLayers`][wk-can-use] holds, the [new image][wk-new-image] isn't painted at all. An old snapshot, in contrast, is [painted][wk-old-image] into an image [with compositing flattened][wk-paint-snapshot], so no clipping layer takes part (inference from those lines).

**What follows (inference).** For a scroll of S and a bar of height h, the clipping layer sits at y = S and the bar at y = 0 within the pseudo-element. The commit message of [`3c71d5e`][wk-3c71d5e] states this same class of fault for fixed elements: once reparented they no longer meet the layer's criteria, the position doesn't account for ancestor offsets, and they clip incorrectly. The sticky case matches that description and the fix doesn't cover it.

**The scrolling tree writes to the same layers.** While the element remains viewport-constrained, its [scrolling tree node][wk-sticky-update] is kept. On iOS the UI process applies positions after [each commit][wk-apply-after-commit] and when the [viewport changes through delegated scrolling][wk-delegated]: [`applyLayerPositions`][wk-apply] writes the [clip][wk-compute-layer-position] from the [layout viewport's delta][wk-viewport-relative] and the anchor from the [sticky offset's delta][wk-anchor-position]. A fixed element, being none while captured, [loses that role][wk-roles].

### The hypothesis of a stale viewport

The idea was that the visible content rect or sticky constraining rect is stale during capture because the UI process owns scrolling.

- **Against, in the web process.** A sticky element's [constraining rect][wk-constraining-rect] is `rectForFixedPositionLayout()`, which [returns the layout viewport][wk-rect-for-fixed], and for a programmatic scroll [`updateLayoutViewport`][wk-update-layout-viewport] recomputes the override rect at once. That `window.scrollTo` runs as a programmatic scroll was not traced, but the correct `getBoundingClientRect()` agrees.
- **Unnecessary for the amount.** The clip above cuts by S without any stale value, so our prediction is that a transition on a scrolled page cuts the bar even with no `scrollTo` in the callback. That's untested.
- **For, in the UI process.** A scroll requested by the page is [forwarded to the UI process][wk-request-scroll], so the scrolling tree's layout viewport can lag the web process. With a lagging viewport at 0, the two writes above give a clip at 0 and an anchor at -S, which moves the band to the top of the bar's slot (see the next section). Whether that state lasts for the whole transition was not established.

## The measurements against the code

All "Measured" entries come from the project's run on Mobile Safari on the iOS 26.3 simulator (Xcode 26.2, `JSC_useJIT=0` because the simulator's JavaScriptCore crashed), and the cut was also seen in Safari on a real iPad. The "Measured" column reports what was seen and the right column what the mechanism above implies.

| Measured                                                                     | From the source                                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Unscrolled, 110px bar: whole                                                 | S = 0, so the window starts at the bar's top                                                                      |
| Scrolled 50px: a thin band, at the bar's top, then full height at the end    | h - S = 60px remain. **The side doesn't follow from the simple geometry**, and the band's height was not recorded |
| Scrolled 600px: nothing, then it appears at the end                          | S is above h, so nothing remains                                                                                  |
| `getBoundingClientRect()` and the group's `transform` are right in every run | Layout isn't affected; only the layer tree is                                                                     |
| `position: fixed` during the transition: whole at 600px                      | The [captured check][wk-sublayers-captured] returns none on the fixed path                                        |
| Stuck `top: 0` header, as the old snapshot, scrolled 400px: correct          | Old snapshots are [painted][wk-old-image], not reparented                                                         |
| Playwright's WebKit on Linux, Android Chrome 133, Chromium 153: not cut      | The setting [is false off Cocoa][wk-pref-default-other]; Chromium has none of this code                           |

The open point is the side. With an up-to-date scrolling tree the window is [S, S + H] over a bar at [0, h], which leaves the bar's lower part at the lower part of its slot. With a lagging tree the window is [0, H] over a bar at [-S, h - S], which leaves the bar's lower part at the top of its slot, as observed. The repro's bar is one colour with centred text, so a report of a band "at the top" most likely describes its position on screen and can't tell which part of the bar it shows. Our inference is that the lagging state is the one observed, which would make the scroll restoration matter for the side but not for the existence of the cut.

The setting's default comes from [`defaultContentInsetBackgroundFillEnabled`][wk-pref-yaml], which on Cocoa [depends on Liquid Glass][wk-pref-default-cocoa] and on the build flag in [`PlatformEnableCocoa.h`][wk-enable], which also lists macOS. This predicts the following, none of it measured:

- **Desktop Safari on macOS 26 or later shows the cut**, because nothing above is iOS-only. If it doesn't, the explanation is wrong or incomplete, and that is the cheapest way to falsify it.
- **Safari on iOS 18 doesn't show it**, because there is no Liquid Glass there.
- **A named stuck header as a new snapshot on a scrolled page is cut too**, because the sticky branch doesn't read which edge is used. This is the [header gap](#workarounds).
- **Capturing the root doesn't help**, because the branch doesn't read the root's state. Our [earlier page][cup-research-sticky]'s dated note says the cut happens whether or not the root is captured, while the repro only ran with `view-transition-name: none`, so this stays a prediction.
- **A sticky element inside an overflow scroller isn't affected**, because it gets [the anchor layer only][wk-sublayers-gate].

## Is it known?

Queries were run on 2026-10-30, anonymously. The trackers only show public entries, and many WebKit bugs link a radar that can't be read.

**WebKit Bugzilla.** Quicksearch for `view transition sticky` returned 8 bugs and `view-transition sticky` 1, and none is this bug. A summary search for all words in `view transition` returned 363 bugs across every status, and for `view-transitions` 222. Titles were screened, with these opened:

- [299578][wk-bug-299578] (Fixed, by Matt Woodrow, 2025-09): the closest, see [the answer](#answer). It has no mention of sticky, and its [pull request][wk-pr-51360] has no discussion beyond the commit.
- [325199][wk-bug-325199] (New, 2026-09, iOS 26): a blank bar behind the floating bottom toolbar during a transition, reproduced on a Chrome demo. It mentions neither sticky nor scrolling, and it is about the area under the toolbar, so it looks different. Its attachment was not viewed.
- [320238][wk-bug-320238] (New, 2026-07, iOS 27): toolbar colour flashes with transitions, where the reporter's best mitigation was `view-transition-name: none` on the root, already set in the repro. It is another symptom.
- [298709][wk-bug-298709] (Reopened, iOS 26): a sticky element disappears past a scroll threshold, without a transition. [Its fix][wk-8a1585e] keeps a stuck layer's backing store from being detached, because the web process's visible rect can leave the layer behind. It's a neighbouring mechanism, see [not established](#not-established).
- [273612][wk-bug-273612] (New, 2024): a request to stop asynchronous scrolling updates during a transition, by the same engineer. It is relevant because the scrolling tree still writes to the captured layers, and its [pull request][wk-pr-29520] was not traced.
- [285400][wk-bug-285400] (New): WebKit not using the snapshot containing block. [`containingBlockRect`][wk-containing-block] still has a FIXME for it. It is about keyframes on the toolbar's inset, not about scrolling.
- [275502][wk-bug-275502] (Invalid, 2024): a new snapshot picking up ancestor clips, closed as no longer reproducible. It predates the clipping layer.
- [310016][wk-bug-310016] (New, 2026-03): an element shifting inside an iframe during a transition, which is a position problem in a different setup.

**WebKit commit log**, GitHub commit search, with result counts: `view-transitions sticky` 0; `view transition sticky` 12, all unrelated; `view transition fixed sticky clipping` 5, unrelated; `view-transitions fixed clipping` 1, unrelated; `view-transitions clip scroll` 7; `view-transitions scroll` 25; `view-transitions snapshot clipped` 10; `view-transitions iOS` 48; `view-transitions iOS snapshot` 4; `view-transitions overflow rect` 9; `view-transitions captureOverflowRect` 6; `view-transitions visibleContentRect` 0; `ViewTransition scrollPosition` 0; `viewport clipping layer` 78; `contentInsetBackgroundFill sticky` 1, which is [`27e72ea`][wk-27e72ea]; `sticky clipping layer` 24. Only [`3c71d5e`][wk-3c71d5e] and its predecessors touch this path. No commit moves the captured check above the sticky branch, as the [current code][wk-sublayers] shows. An issue and pull request search for `view transition sticky` (66) and `viewport clipping layer view transition` (29) showed only [51360][wk-pr-51360] among the first results, and the first 8 of each were read.

**`w3c/csswg-drafts`**, GitHub issue search: `view transition sticky` 20 and `view-transition sticky position` 9, of which only [#10197][csswg-10197] (open) concerns transitions and sticky, in one passing comment about old snapshots while scrolling. `view transition snapshot clipped scroll` 11, whose nearest is [#9481][csswg-9481] (open), about clipping captures to the viewport for performance. `view-transition position fixed snapshot Safari` 2, unrelated. No entry concerns this bug.

**web-platform-tests.** A recursive search for sticky in [`css/css-view-transitions`][wpt-tree] at `3a45943` found no file, and GitHub code search in WebKit's `LayoutTests` for `position: sticky` with `view-transition-name` returned 0, which is weak evidence. [`new-content-transform-position-fixed.html`][wpt-fixed] covers the fixed case and is one of the tests that [`3c71d5e`][wk-3c71d5e] fixed, so a sticky case has no test on any engine that we could find, which would explain why it went unnoticed (inference).

**Web search**, three queries combining `view transition`, `position: sticky`, iOS Safari 26 and cut-off or blank snapshots, found no report of this and no workaround for it. [An Apple forum thread][apple-801028] on sticky `bottom: 0` and the toolbar, on iOS 26.0, doesn't involve transitions.

## Is it specified?

[Level 1, 7.7][vt1-capture] renders an element and its descendants over an infinite transparent canvas and returns the part covering the ink overflow rectangle. [Capture rendering characteristics][vt1-rendering] ignore effects from ancestors, and let an implementation clip only when the ink overflow exceeds an implementation-defined maximum, while it should keep at least the contents that intersect the snapshot containing block. [Level 2][vt2-rendering] has the same section. Neither level mentions sticky, in a full-text search of both drafts.

Our reading: a stuck bar lies within the snapshot containing block, so a capture that drops it falls short of that minimum, and a clip from the viewport machinery is not one of the permitted reasons. That's a "should", not a "must", so the behaviour isn't strictly forbidden, but the [fixed-element fix][wk-3c71d5e] shows that WebKit treats the sibling case as a bug.

## Workarounds

### (a) Shipped: fixed during the transition

[`bottomBarDuringViewTransition`][cup-fade-footer] switches the bars to `position: fixed; inset-inline: 0` while `:root:active-view-transition` matches, and the [shell][cup-shell] sets a 400px row, so that the document doesn't get shorter and clamp the scroll position.

- **For:** it is the only option run on an affected browser (whole bar at 600px on the iOS 26.3 simulator). It works through [the branch WebKit fixed][wk-sublayers-captured], so it isn't relying on an accident. It needs no engine-specific code, and it needs no markup.
- **Against:** a layout switch and a magic row height that exist only for this bug. The run covered one scroll position. Cup's [`<header>`][cup-header] is sticky with a name as well, so if a screen with a header becomes the new state on a scrolled page, the prediction is that it gets cut too, and (a) doesn't cover it. On Safari builds before the fix, fixed elements are cut as well (inference from the [commit][wk-3c71d5e], which reached the [`safari-7622` branch][wk-bug-299578]).

### (b) Bars always `position: fixed`

- **For:** no transition-only state and no 400px row. The geometry is the one tested for (a), since a fixed bar during a transition is the same case. It has no dependency on `:active-view-transition`.
- **Against:** the always-fixed layout itself is untested. Each bar needs a known height for the `shell-footer` row, which [`player-sheet.tsx`][cup-player-sheet] and [`recents-layout.tsx`][cup-recents] would have to publish; whether their heights are constant was not checked. It takes the same browser path as (a), so it isn't more robust against the bug, and on idle scrolling a fixed bar [gets the clipping layer too][wk-27e72ea]. It's a larger change for the same result, worth it only if the inner name fails and the transition-only switch keeps causing trouble.

### (c) Lighter options that keep the bars sticky

**Name an inner element.** A non-sticky, non-fixed element [gets no viewport layers][wk-sublayers-captured] (the same function returns none for it), so a named inner element's own layer has no clipping layer to bring along, and the sticky parent's clipping layer isn't what is reparented. A captured layer [skips the enclosing layer's child list][wk-skip-enclosing] and [ignores clipping from ancestors][wk-clipped-by-ancestor], so its position should be correct (inference, untested). The sticky parent stays in flow, so no row is needed. In Chromium a named descendant should follow its stuck parent, given that a [named stuck bar measured correctly with the root uncaptured][cup-research-sticky] (inference). The cost is one wrapper per bar: the fade's `::before`, the background and the padding move to the inner element, and the fade's `z-index: -1` needs a stacking context there.

**`overflow: clip` on `::view-transition-new(bottom-bar)`.** When the pseudo-element has non-visible overflow, [`canUseExistingLayers`][wk-can-use] is false in `main` and in [the 7623 tag][wk-7623-can-use], so [the layers aren't reparented][wk-collect-check] and [the image is painted][wk-new-image], the same way as an old snapshot, which the header run showed correct. [`b4321a0`][wk-b4321a0] built this fallback in 2024 for `overflow: hidden` and describes it as snapshotting each frame, and [`pseudo-element-overflow-hidden.html`][wpt-overflow] tests the behaviour. It takes one CSS rule and no markup, but it clips to the pseudo-element's box, and Cup's [fade][cup-fade-footer] sits above the bar, so the fade is lost until the transition ends. [`overflow-clip-margin`][bcd] isn't in Safari, per browser-compat-data, so the clip can't be widened. Painting each frame also costs more than a layer, though for two small bars that's probably minor (inference).

**Compositing an ancestor during the transition.** The clipping layer also requires the [compositing ancestor to be the render view][wk-sublayers-gate], so a composited ancestor such as the shell with a [compositing `will-change`][wk-will-change] should leave the anchor layer only. This is an untested idea. It relies on a side effect, it makes a page-sized layer, and the scrolling tree still writes the anchor. Ranked last of the real candidates.

**Changing when the scroll position is restored.** This won't help, on the source. The clip follows the layout viewport whenever it is scrolled, so restoring after capture should give the same cut, and restoring before capture would put the old snapshot at the wrong position. [TanStack Router][cup-research-vt] owns the restoration as well. It may change which side is cut. Untested.

**`contain`, `will-change` or `translateZ` on the bar.** These can't help, on the source: the [sticky branch][wk-sublayers-gate] reads none of them, and a compositing hint on the bar leaves its compositing ancestor the same. `object-view-box` also forces [`canUseExistingLayers`][wk-can-use] to false, but only since [`0d63417`][wk-0d63417], and [browser-compat-data][bcd] lists it as preview in Safari and absent on iOS.

**`overflow: clip` on an ancestor.** This won't help: [`hasPotentiallyScrollableOverflow`][wk-potentially-scrollable] excludes `clip`, so the ancestor isn't [an overflow layer][wk-async-sticky] for the sticky element. Other overflow values would [change the sticky rect][wk-constraining-rect] and stop the bar sticking to the viewport.

### (d) Browser sniffing or feature detection

Feature detection isn't possible, on what we measured and read. `getBoundingClientRect()` and the group's transform are correct while the image is cut, and pixels of a pseudo-element can't be read from script. The deciding value is an [internal setting][wk-pref-yaml], and we found no way for a page to read it. User-agent sniffing is possible but gains little: (a) and the inner name are harmless elsewhere, so a sniff would only hide them from unaffected browsers, it can't name a fix version because none exists, and it would misjudge any future fix or the desktop prediction above. How an iPad's user agent reads was not checked. Rejected.

## What to run next

These are the runs that would settle the ranking. They are not in this note's scope, and the repro can get them as URL variants. Each goes through a Back transition at scrolls of 50 and 600.

1. **Inner name:** a sticky `.bar` with no paint of its own and a named `.bar-inner` holding the visuals. A whole bar at both scrolls makes this the replacement for (a).
2. **`overflow: clip`** on the new pseudo-element, unchanged markup. A whole bar confirms the live-layer path as the cause, whatever is done about the fade.
3. **No scroll in the callback:** a transition that keeps the same scroll position. A cut here rules out scroll restoration as the cause.
4. **A taller bar with an asymmetric pattern** (a gradient or stripes). This shows which part of the bar is visible and where, which settles the side and the band's height.
5. **Desktop Safari on macOS 26 or later**, with the same page. This falsifies or supports the Liquid Glass gate, and needs no simulator.
6. **A named sticky header as the new snapshot** on a scrolled page. This decides whether [`<header>`][cup-header] needs the same fix.

## Not established

- **That the clipping layer is the cause at runtime.** No debugger, layer dump or modified build was used. Web Inspector's compositing borders [include this layer][wk-27e72ea] and might confirm it on the simulator, which was not tried.
- **Which side is cut, and the role of the UI process's lag**, as described in [the measurements](#the-measurements-against-the-code).
- **Whether another mechanism contributes.** A layer's [backing store can be detached][wk-8a1585e] when the web process's visible rect misses it, as in [298709][wk-bug-298709]. A whole detached layer wouldn't explain a partial band, so we rank it lower, but it wasn't ruled out, and it would be a better fit if the "thin band" proves unrelated to h - S.
- **Which WebKit tag ships in iOS 26.3.** The [7623 tag][wk-7623] was read because it is the newest tag of that series and has the same sticky branch and fallback. Links point to `main` except where stated.
- **Whether a restricted radar covers this.** Radars aren't readable. [WebKit 299578][wk-bug-299578]'s radar is the one the release notes describe, and whether its sticky wording reflects further work outside the open repository wasn't established.
- **How the Capacitor shells behave.** Their WebView is WKWebView, so the setting's Cocoa path applies, but whether Liquid Glass is on there depends on the app's build, and this wasn't checked.
- **Whether the rank 2 to 5 options work.** None has been run.

A report to WebKit has not been filed. The repro and the [branch order][wk-sublayers] would be enough for one, and the implied fix is to apply the captured check to sticky elements too. Whether that fix is sufficient, given the scrolling tree's writes, is unverified.

This note doesn't update [the architecture page][cup-architecture], [the earlier research page][cup-research-sticky] or the comment in [`fade-footer.ts`][cup-fade-footer], which were out of scope for this change. The architecture page and the earlier note state the behaviour only, and neither needs correcting unless the workaround changes.

[apple-801028]: https://developer.apple.com/forums/thread/801028
[bcd]: https://www.npmjs.com/package/@mdn/browser-compat-data/v/8.1.7
[csswg-10197]: https://github.com/w3c/csswg-drafts/issues/10197
[csswg-9481]: https://github.com/w3c/csswg-drafts/issues/9481
[cup-architecture]: ../architecture/web-app.md
[cup-commit]: https://github.com/patricktree/cup/tree/a4225703d83f159d454ec9d6fa73d002a521e893
[cup-fade-footer]: https://github.com/patricktree/cup/blob/a4225703d83f159d454ec9d6fa73d002a521e893/apps/web-app/src/app/components/fade-footer.ts
[cup-global-styles]: https://github.com/patricktree/cup/blob/a4225703d83f159d454ec9d6fa73d002a521e893/apps/web-app/src/app/global-styles.ts
[cup-header]: https://github.com/patricktree/cup/blob/a4225703d83f159d454ec9d6fa73d002a521e893/apps/web-app/src/app/components/main.tsx
[cup-player-sheet]: https://github.com/patricktree/cup/blob/a4225703d83f159d454ec9d6fa73d002a521e893/apps/web-app/src/app/components/player-sheet.tsx
[cup-recents]: https://github.com/patricktree/cup/blob/a4225703d83f159d454ec9d6fa73d002a521e893/apps/web-app/src/app/components/recents-layout.tsx
[cup-research-sticky]: view-transition-sticky-position.md
[cup-research-vt]: recents-detail-view-transitions.md
[cup-shell]: https://github.com/patricktree/cup/blob/a4225703d83f159d454ec9d6fa73d002a521e893/apps/web-app/src/routes/_shell.tsx
[safari-26-2]: https://webkit.org/blog/17640/webkit-features-for-safari-26-2/
[vt1]: https://drafts.csswg.org/css-view-transitions-1/
[vt1-capture]: https://drafts.csswg.org/css-view-transitions-1/#capture-the-image-algorithm
[vt1-rendering]: https://drafts.csswg.org/css-view-transitions-1/#capture-rendering-characteristics
[vt2]: https://drafts.csswg.org/css-view-transitions-2/
[vt2-rendering]: https://drafts.csswg.org/css-view-transitions-2/#capture-rendering-characteristics
[wk-0d63417]: https://github.com/WebKit/WebKit/commit/0d63417844a1f3efbec6c8cece36bf78d39c9263
[wk-27e72ea]: https://github.com/WebKit/WebKit/commit/27e72ea1a69bee0f87ea794f1f55e34c7d7c4650
[wk-3c71d5e]: https://github.com/WebKit/WebKit/commit/3c71d5e470ce90242e668671d7174a45e3165515
[wk-7623]: https://github.com/WebKit/WebKit/tree/WebKit-7623.1.14.14.9
[wk-7623-can-use]: https://github.com/WebKit/WebKit/blob/9d5cf7efab639a00ecd11599291a799733ba88d5/Source/WebCore/rendering/RenderViewTransitionCapture.h#L60
[wk-7623-sublayers]: https://github.com/WebKit/WebKit/blob/9d5cf7efab639a00ecd11599291a799733ba88d5/Source/WebCore/rendering/RenderLayerCompositor.cpp#L4253-L4268
[wk-8a1585e]: https://github.com/WebKit/WebKit/commit/8a1585ea9d5f7640950c6adc88119cd724987f25
[wk-anchor-position]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/page/scrolling/ScrollingConstraints.cpp#L107-L111
[wk-apply]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/page/scrolling/cocoa/ScrollingTreeStickyNodeCocoa.mm#L64-L86
[wk-apply-after-commit]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebKit/UIProcess/RemoteLayerTree/RemoteScrollingCoordinatorProxy.cpp#L329-L332
[wk-async-sticky]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L4270-L4296
[wk-b4321a0]: https://github.com/WebKit/WebKit/commit/b4321a0a6e7085a38a340b6353a0ddef31d9f5f8
[wk-bug-273612]: https://bugs.webkit.org/show_bug.cgi?id=273612
[wk-bug-275502]: https://bugs.webkit.org/show_bug.cgi?id=275502
[wk-bug-285400]: https://bugs.webkit.org/show_bug.cgi?id=285400
[wk-bug-298709]: https://bugs.webkit.org/show_bug.cgi?id=298709
[wk-bug-299578]: https://bugs.webkit.org/show_bug.cgi?id=299578
[wk-bug-310016]: https://bugs.webkit.org/show_bug.cgi?id=310016
[wk-bug-320238]: https://bugs.webkit.org/show_bug.cgi?id=320238
[wk-bug-325199]: https://bugs.webkit.org/show_bug.cgi?id=325199
[wk-can-use]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderViewTransitionCapture.cpp#L53-L56
[wk-child-for-superlayers]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerBacking.cpp#L4321-L4330
[wk-clip-create]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerBacking.cpp#L3142-L3148
[wk-clipped-by-ancestor]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L3638-L3639
[wk-collect]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L1681-L1714
[wk-collect-check]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L1686-L1687
[wk-compute-layer-position]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/page/scrolling/ScrollingTreeViewportConstrainedNode.cpp#L53-L62
[wk-constraining-rect]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderBoxModelObject.cpp#L734-L761
[wk-containing-block]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/dom/ViewTransition.cpp#L1097-L1107
[wk-delegated]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebKit/UIProcess/RemoteLayerTree/RemoteScrollingCoordinatorProxy.cpp#L324-L327
[wk-enable]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WTF/wtf/PlatformEnableCocoa.h#L1203-L1208
[wk-geometry]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerBacking.cpp#L1809-L1832
[wk-geometry-capture]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerBacking.cpp#L1785-L1792
[wk-main]: https://github.com/WebKit/WebKit/tree/a82d5c77d87791f0599f54a405a203481664f70d
[wk-new-image]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/dom/ViewTransition.cpp#L1266-L1272
[wk-old-image]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/dom/ViewTransition.cpp#L723-L734
[wk-paint-snapshot]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/dom/ViewTransition.cpp#L558-L573
[wk-potentially-scrollable]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderElementInlines.h#L113-L118
[wk-pr-29520]: https://github.com/WebKit/WebKit/pull/29520
[wk-pr-51360]: https://github.com/WebKit/WebKit/pull/51360
[wk-pref-default-cocoa]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebKit/Shared/Cocoa/WebPreferencesDefaultValuesCocoa.mm#L192-L199
[wk-pref-default-other]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebKit/Shared/WebPreferencesDefaultValues.cpp#L475-L480
[wk-pref-yaml]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L1639-L1646
[wk-rect-for-fixed]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/page/LocalFrameView.cpp#L2279-L2285
[wk-request-scroll]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebKit/UIProcess/RemoteLayerTree/RemoteScrollingCoordinatorProxy.cpp#L225-L245
[wk-roles]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L5729-L5733
[wk-skip-enclosing]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L1878-L1885
[wk-sticky-update]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L5533-L5562
[wk-sublayers]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L4298-L4345
[wk-sublayers-captured]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L4331-L4335
[wk-sublayers-gate]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L4302-L4329
[wk-update-layout-viewport]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/page/LocalFrameView.cpp#L2022-L2030
[wk-viewport-relative]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/page/scrolling/ScrollingConstraints.cpp#L43-L58
[wk-will-change]: https://github.com/WebKit/WebKit/blob/a82d5c77d87791f0599f54a405a203481664f70d/Source/WebCore/rendering/RenderLayerCompositor.cpp#L4026-L4029
[wpt-fixed]: https://github.com/web-platform-tests/wpt/blob/3a459437419d3f638a81025ffe6ed4f150dd4b21/css/css-view-transitions/new-content-transform-position-fixed.html
[wpt-overflow]: https://github.com/web-platform-tests/wpt/blob/3a459437419d3f638a81025ffe6ed4f150dd4b21/css/css-view-transitions/pseudo-element-overflow-hidden.html
[wpt-tree]: https://github.com/web-platform-tests/wpt/tree/3a459437419d3f638a81025ffe6ed4f150dd4b21/css/css-view-transitions
