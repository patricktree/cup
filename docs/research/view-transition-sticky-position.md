# Stuck sticky elements during a View Transition

> 2026-10-30, after this page was written: Cup replaced the fixed bars and the 400px row with `:root { view-transition-name: none }`, ranked second below. Measured on Android Chrome 133 in an emulator with a 48px bottom strip and a tall page, at the top and scrolled by 250px: a stuck, named bar's bottom was 784 with the root captured and 736 (`innerHeight`) without it, in both directions, and Back restored the scroll position. Naming `main` on both screens to keep a cross-fade made its snapshot slide by the difference in scroll position, so each screen's content has a name of its own instead.
>
> 2026-10-30, later: the bottom bars are fixed during a transition again, for a different reason, and the 400px row is back. On iOS Safari, the snapshot of a stuck `position: sticky; bottom: 0` element is cut by the page's scroll position, whether or not the root is captured: the operator saw the bar cut off a little way down Recents and missing further down, until it appeared when the transition ended. A minimal page reproduced this on Mobile Safari on the iOS 26.3 simulator, with the bar cut off at a scroll of 50px and missing at 600px, and `position: fixed` showed the whole bar at 600px. Its `getBoundingClientRect` was correct in every run, so the position is right and only the snapshot is cut. A stuck `top: 0` header faded correctly from a scrolled page. Playwright's WebKit on Linux does not show this. No report of it was searched for.
>
> 2026-10-30, after this page was written: the predicted rise of the shell header did not show. The operator watched the detail view's sticky header on Brave on an Android phone during a transition, by eye, and it stayed correct both with the URL bar showing and with it scrolled away. With the URL bar away there is no offset to rise by. With the URL bar showing, this contradicts the prediction below and is unexplained: the 56px measurement behind it came from a test element on Chrome 133 on an emulator, not from the header itself, and the header was not measured. So the explanation is only partly confirmed: the bottom edge matches the measured drop, and the top edge has this counterexample. The header needs no fix.

Research date: 2026-10-30. Sources are the Chromium source at [`main` commit `0b2cf11`][cr-main] (committed 2026-10-30) and tag [`133.0.6943.0`][cr-133], the branch point of the measured Chrome 133; CSS View Transitions [Level 1][vt1] (Editor's Draft, 2025-02-16) and [Level 2][vt2] (Editor's Draft, 2026-08-31), both read verbatim; [CSS Positioned Layout Level 3][position] (Editor's Draft, 2026-05-14); the issue trackers named below; and `@mdn/browser-compat-data` 8.1.7 (2026-10-22). Repository observations describe commit [`c08d786`][cup-commit]. The measurements in the first section were taken by the project on 2026-10-30 on Android Chrome 133 in an emulator, and a user saw the same symptom in Brave on an Android phone. This investigation ran no browser or device. Every statement marked as an inference or a prediction is untested, and no workaround below was tried.

## Question

During a same-document View Transition, why is a stuck `position: sticky; bottom: 0` element drawn lower by the height of the browser's bottom UI? Is this known, is it specified, and which workarounds exist other than [ours][cup-fade-footer] (fixed bars during the transition, plus a [400px grid row][cup-shell])?

## Answer

- **Is it known?** No report of this exact behaviour was found in the Chromium tracker, `w3c/csswg-drafts`, Mozilla Bugzilla or WebKit Bugzilla, and no fix has landed: the code path below is the same in Chrome 133 and in `main` on 2026-10-30. The closest entry is [`w3c/csswg-drafts#8625`][csswg-8625], open since 2023, about the same offset between the snapshot root and the viewport, but for author coordinates rather than sticky layout. The Chromium tracker search only sees public issues, so a restricted report cannot be ruled out.
- **Cause, from the source:** while the root is captured, `LayoutView::ViewRect()` returns the snapshot root instead of the frame. The document scroller's overflow clip comes from that rect, and sticky constraints come from the overflow clip. The rect's bottom edge therefore sits under the bottom toolbar, and a stuck bar follows it. This predicts every measured number (see [the measurements](#the-measurements-against-the-code)).
- **Specified, a bug, or undefined?** The specifications say nothing about sticky positioning during a transition, so it is undefined in the sense that no text addresses it. Our reading is that it is a Chromium bug: the snapshot containing block is defined for the transition's pseudo-elements, and capture must happen "without moving or resizing the layout viewport" ([Level 1, 7.7][vt1-capture]). No Chromium engineer has commented on the sticky case, so that judgement is ours.
- **Keep our workaround for now.** It is the only option measured to work, it keeps the root cross-fade, and it needs nothing from other engines. The best alternative is `:root { view-transition-name: none }`, because it removes the cause instead of avoiding it, but it gives up the root cross-fade and is untested.
- **A gap in our workaround:** Cup's [shell header][cup-header] is `position: sticky; top: 0`, and the same rect has its top edge under the URL bar. Our inference is that a stuck header rises by the URL bar's height during a transition, when the page is scrolled and the URL bar is showing. The workaround does not cover it, and nobody has measured it.

Ranked for Cup, best first. "Removes the cause" means the sticky rect stays the viewport.

| Rank | Option                                                                     | Evidence                                               | Removes the cause | Main cost                                                                              |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------- |
| 1    | Ours: fixed during the transition, plus a 400px row                        | Measured on Chrome 133                                 | No, avoids it     | A layout switch and a magic row height; the header stays uncovered                     |
| 2    | `:root { view-transition-name: none }` with named content                  | Source reading, untested                               | Yes               | No root cross-fade; a replacement needs named wrappers                                 |
| 3    | Bars always `position: fixed`                                              | Fixed geometry measured; the always-fixed layout isn't | No, avoids it     | Each screen must reserve the bar's height                                              |
| 4    | Measure the drop in script and compensate                                  | Inference, untested                                    | No                | Script tied to the router's transition, and a timing risk on the first frame           |
| 5    | Element-scoped transition on a subtree                                     | Source reading, untested                               | Yes               | Chrome 147+ only; the router calls the document API; layout containment on the subtree |
| 6    | Dedicated scroll container                                                 | Source reading, untested                               | Probably          | Contradicts Cup's [documented reason][cup-shell] for scrolling the document            |
| None | `interactive-widget`, `window.snapshotRoot`, `position: fixed` with anchor | See [workarounds](#workarounds)                        | No                | They address something else, or don't exist                                            |

## The mechanism in the source

[`LayoutView::ViewRect()`][cr-viewrect] returns the frame's size at origin zero, except while `IsRootTransitioning()` is true in the outermost main frame. It then returns `PhysicalRect(GetFrameToSnapshotRootOffset(), GetSnapshotRootSize())`. A comment there gives the purpose: the root snapshot needs a stable size that excludes insetting UI such as the URL bar.

[`LayoutView::OverflowClipRectInternal`][cr-overflow-clip] starts from `ViewRect()`, and [`LayoutBox::ComputeStickyConstrainingRect`][cr-sticky-rect] starts from `OverflowClipRect()`. [`ComputeStickyPositionConstraints`][cr-sticky-constraints] takes its `constraining_rect` from there, and [`ComputeOffset`][cr-sticky-offset] limits a `bottom` inset to the end of that range. So the document scroller's sticky rect is the snapshot root for as long as the condition holds.

[`GetFixedToSnapshotViewportOutsets`][cr-outsets] gives the snapshot root's size: when `controls.ShrinkViewport()` is true it adds `TopHeight - TopMinHeight` above and `BottomHeight - BottomMinHeight` below, and it always adds `GetVirtualKeyboardResizeHeight()` below. The Chromium [README][cr-readme] describes the snapshot root as invariant to viewport widgets. It covers the painted snapshot and the pseudo-elements, and doesn't mention sticky elements.

[`IsRootTransitioning()`][cr-is-root] depends only on the document element being a transition element, which the tracker [records when the element gets a name][cr-root-flag]. [`IsTransitionElement`][cr-is-transition] returns false in the `kIdle` and `kCaptured` states, so the rect should be the normal one while the update callback runs (inference from those lines; the invalidation that re-lays out sticky boxes was not traced).

The same chain is in Chrome 133: [`ViewRect`][cr-133-viewrect], [`OverflowClipRect`][cr-133-overflow], [`ComputeStickyConstrainingRect`][cr-133-sticky-rect] and [the outsets][cr-133-outsets].

[`eecfc51`][cr-eecfc51] (bug 1348555, first in 108.0.5343.0 per [Chromium Dash][dash-eecfc51]) expanded `ViewRect` to the snapshot size, and its message describes the expansion as a change for painting. [`c92e6ce`][cr-c92e6ce] (bug 1410953, first in 112.0.5578.0 per [Chromium Dash][dash-c92e6ce]) moved the offset from a paint offset onto the layout view rect. [`9ede207`][cr-9ede207] (bug 1383980, first in 111.0.5559.0 per [Chromium Dash][dash-9ede207]), one of the starting points for this research, made the snapshot rect the containing block of `::view-transition`, and its diff only renames the rect's accessor in `ViewRect`. Our inference is that the sticky effect is an unintended side effect of a painting change, and that the offset part dates from Chrome 112. Whether sticky read this rect in those older versions was not checked.

## The measurements against the code

With a top controls height T = 56 and a bottom controls height B = 48, `innerHeight` 736 gives a snapshot root running from -56 to 784 in viewport coordinates. Everything except the two predictions in the next list was measured by the project on 2026-10-30.

| Measured                                                   | From the rect                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `::view-transition` height 840                             | 736 + 56 + 48                                                                            |
| `position: sticky; top: 736px` has rect top 680            | -56 + 736                                                                                |
| Stuck `bottom: 0` is drawn lower by the bottom UI's height | Rect bottom 784, which is 48 below 736                                                   |
| Top URL bar only: no drop                                  | B = 0, so the rect's bottom edge stays at 736, although the top offset exists            |
| Short page, bar not stuck: no large drop                   | [`ComputeOffset`][cr-sticky-offset] only moves a box whose natural end exceeds the limit |
| `position: fixed; bottom: 0` has rect bottom 736           | This rect isn't used for fixed boxes (measured; the fixed path was not read)             |
| Own `view-transition-name` doesn't stop the drop           | The shift is in layout, and the group's transform maps the element's visual position     |

The code also predicts the following, none of it measured:

- **A stuck `top: 0` element rises by T**, because the limit becomes -56. This is the [header gap](#answer).
- **No drop with the toolbars hidden.** Once the user scrolls the controls away, `ShrinkViewport()` should be false and the outsets zero. The drop should then only appear when the controls are showing.
- **No drop at the very end of the page**, because the bar's natural position is already above the limit. In the last B pixels of scroll the drop should be partial.
- **Chrome with its [address bar at the bottom][chrome-bottom-bar]** should drop by the bar's height for any user who chose that setting. On that setup T is presumably zero.
- **An open keyboard with `interactive-widget=resizes-content`** should drop a stuck bar by the keyboard's height, through `GetVirtualKeyboardResizeHeight()`. Cup's [`index.html`][cup-index] doesn't set this key.

## Is it known?

The Chromium tracker was searched anonymously on 2026-10-30 for `"view transition" sticky` (36 results), `"view transitions" sticky` (60, of which only the first 50 rows were available and only some were read), `"view-transition" sticky`, `"view transition" "position: sticky"`, `startViewTransition sticky`, `"snapshot root" sticky`, `"view transition" "url bar"`, `"view transition" "browser controls"`, `"view transition" footer android`, `"view transition" "bottom bar"`, and `"view transition" toolbar jumps`. Titles were screened and likely candidates opened. None describes a stuck element shifting by the browser's UI. A GitHub commit search on the Chromium mirror for sticky and view transition terms returned nothing, which is weak evidence because that search may not index the mirror fully. The source comparison above is the stronger evidence that no fix landed.

Related entries, none of which is this bug:

- [`w3c/csswg-drafts#8625`][csswg-8625] (open): Jake Archibald reports that a clip-path computed from `clientX`/`clientY` lands in the wrong place on Android Chrome, which he calls intended, because the snapshot root's origin is under the URL bar, and proposes `window.snapshotRoot`. David Bokan agrees and suggests putting it on `ViewTransition` instead ([same thread][csswg-8625]; [archived message][archive-8625]). The thread has no mention of sticky.
- [`w3c/csswg-drafts#7859`][csswg-7859] (closed): the origin of the "snapshot viewport", which Bokan defines as a rect that keeps its size and position whichever browser UI is showing ([archived message][archive-7859]). The group resolved to use it for the root snapshot and for `::page-transition`, the former name of `::view-transition` ([resolution][csswg-7859]).
- [Chromium 420743939][crbug-420743939] (Assigned, P2): the same clip-path shift, with no fix recorded. [Chromium 396091324][crbug-396091324] (WAI): group keyframes relative to the snapshot containing block, where Chromium engineers call that correct per spec.
- [Chromium 407785176][crbug-407785176] (New, P2): bands between sliding pages on Android. A Chromium engineer writes that it may be per spec, because of the different containing block.
- [Chromium 549552306][crbug-549552306] (New, P2): same-document transitions abort while the URL bar is moving, reported against `SnapshotRootDidChangeSize`. It matters to Cup separately from this page.
- [Chromium 40252472][crbug-40252472] (Fixed, January 2023): a dialog in the top layer fading in above its real position because of the same offset, so the class of problem has been fixed case by case before.
- [Chromium 40281852][crbug-40281852] (Obsolete): sticky and z-index during a transition, answered by naming the bar. This is the same reason Cup [names its bars][cup-fade-footer], and it has nothing to do with the drop.

[`css/css-view-transitions` in web-platform-tests][wpt-tree] (commit `7fd42b5`) has no file mentioning sticky. [`browser-controls-root-offset-new.html`][cr-wpt-internal] in Chromium's internal tests sets browser controls but only checks fixed-position corners, and [`view_transition_test.cc`][cr-vt-test] has no mention of sticky either.

Mozilla Bugzilla's quicksearch returned nothing for `view transition sticky` or `view-transition toolbar`, and a summary filter on "view transition" in Core (limited to 200 results) showed no match. WebKit Bugzilla's quicksearch for `view transition sticky` and `view transition` had no report of this shift. The nearest are [WebKit 320238][webkit-320238], about toolbar colour, and [WebKit 285400][webkit-285400], about Safari apparently not using the snapshot containing block for group keyframes. Neither engine's `ViewTransition.cpp` mentions sticky ([Gecko][gecko-vt], [WebKit][webkit-vt]), and Gecko's [`SnapshotContainingBlockRect`][gecko-vt] uses the visible area's origin and the viewport-unit size. Whether Firefox or Safari shows this drop was not established.

## Is it specified?

[Level 1, 4.1][vt1-scb] defines the snapshot containing block as a rectangle over every area of the window that could show page content, which on mobile includes the retractable URL bar. It acts as the absolute and fixed positioning containing block for `::view-transition` and its descendants. [Level 2, 6.1][vt2-scb] has the same text. Neither level mentions `sticky` or `scrollport` anywhere (full-text search of both drafts).

[Level 1, 7.7][vt1-capture] says that capturing the document element renders areas outside its scrolling box as though scrolled to, leaving the layout viewport as it is and firing no scroll or resize events. [CSS Positioned Layout, 3.4][position-sticky] computes sticky offsets against the nearest scrollport. [CSS Overflow][overflow] defines a scrollport as coinciding with a scroll container's padding box.

Our reading: no text moves a sticky box's reference to the snapshot containing block, so the Chromium behaviour is not required by the specification, and it changes layout (`getBoundingClientRect`) while the layout viewport is supposed to stay put. A counter-argument is that that clause leaves open what the area under a toolbar shows during capture. That clause applies only to the document element's image, and it can't explain the shift in layout or in a named element's own snapshot, which we measured.

[`w3c/csswg-drafts#10197`][csswg-10197] (open) covers scrolling during a transition and has one commenter naming sticky elements in passing, on a different problem. No open CSSWG issue was found on sticky geometry during capture.

## Workarounds

### Ours: fixed during the transition

[`bottomBarDuringViewTransition`][cup-fade-footer] switches the bars to `position: fixed; inset-inline: 0` while `:root:active-view-transition` matches, and the [shell][cup-shell] sets a 400px row so the document doesn't get shorter and clamp its scroll position. The drop is gone in the project's measurements, which fits `position: fixed; bottom: 0` measuring 736. It keeps the root cross-fade and needs no engine-specific code. Its costs are a layout change that exists only to avoid a browser bug and a row height that must stay above any bar's height. The [header gap](#answer) stays open.

### `:root { view-transition-name: none }` with named content

This is the only option that removes the cause without changing the scroll setup. The UA stylesheet's [`:root { view-transition-name: root }`][vt1-ua] is what makes the document element a transition element. With the name removed, [`IsRootTransitioning()`][cr-is-root] should stay false, `ViewRect()` should return the frame, and neither sticky rects nor [the document's enlarged contents size][cr-contents-size] would change (inference from the source). The bars could then stay sticky, and the fixed switch and the 400px row could go. The bars' own names, needed to pass above the cover, would stay. Named elements would be placed correctly, because their layout would be correct.

The behaviour itself is covered by a test: [`no-root-capture.html`][wpt-no-root] expects unnamed text to stay untouched by the transition, because the root isn't captured. That is also the cost. Unnamed content changes at once under the moving cover, while [Cup's architecture][cup-architecture] has the rest of the screen cross-fade, and [`screenFadeViewTransition`][cup-cover] has nothing else to show. Keeping the cross-fade needs a name on a wrapper such as shell `<main>`. Such a snapshot is the element's full height, an implementation may clip it to at least what intersects the snapshot containing block ([Level 1, capture rendering characteristics][vt1-capture]), and its group would morph in size between screens of different heights. How that looks is untested, and it may need its own `::view-transition-group` styles. Whether the cross-fade can be dropped is a product decision.

Reports from others are mixed and don't test this bug. The reporter of [WebKit 320238][webkit-320238] found this setting the most successful mitigation for a Safari toolbar flash. The reporter of [Chromium 542796760][crbug-542796760] uses it and sees fixed content in the top layer misplaced when the root has `overflow: clip` or `hidden` while scrolled, and a Google triager did not reproduce that in a Windows test ([same issue][crbug-542796760]). If Cup locks the document's scroll while a dialog is open, check this combination.

### Bars always `position: fixed`

The measured `position: fixed; bottom: 0` needs no layout switch, so an always-fixed bar needs no transition-only state and no 400px row. Each screen must then reserve the bar's height, either as a known value or by measuring it; which of those [`player-sheet.tsx`][cup-player-sheet] and the Recents footer would need was not checked. Cup's [`fadeFooterClearance`][cup-fade-footer] currently relies on the footer having its own row. It is a structural change that swaps one workaround for another, though it would be a permanent and simpler one. Our inference is that the same could be done for the header.

### Compensation in script

Our inference: a sticky inset can undo the shift, because the limit is `end - inset`, but B isn't reachable from CSS. `100lvh - 100dvh` gives T + B together. [Chromium 396091324][crbug-396091324] records that the snapshot containing block's geometry isn't readable either, and the rect has to be measured from a stuck element. Measuring in `transition.ready` and writing a custom property, or adjusting the group's keyframes, may still miss the first frame or the old snapshot. The router owns the transition's start. The same applies to a `::view-transition-group` adjustment: giving the bar a name [doesn't stop the drop](#the-measurements-against-the-code), and `bottom: 0` on a group would resolve against the snapshot containing block, which has the same bottom edge. Rebuilt keyframes also have to be relative to that block, as [Chromium 396091324][crbug-396091324] explains.

### Element-scoped view transitions

[Level 2, section 4][vt2-scoped] defines `element.startViewTransition()`. `Element.startViewTransition` and `view-transition-scope` are in Chrome and Chrome Android 147, and not in Firefox or Safari ([browser-compat-data][bcd]). In `ViewRect`, the check goes through the document-level `GetTransition`, and the [root flag][cr-root-flag] only applies to the document element. Our inference is that a scope below the document element keeps the sticky rect normal. A Chromium engineer [recommends scoped transitions][csswg-10197] for a related scroll problem. Against it for Cup: a scope gets layout containment automatically ([Level 2][vt2-scoped]), and our inference is that this makes the scope the containing block for fixed descendants inside it. [TanStack Router calls the document API][cup-research-vt]. Other browsers would need a fallback path to `document.startViewTransition`, which brings the question back wherever the bug also occurs.

### Dedicated scroll container

For a plain box, [`LayoutBox::OverflowClipRect`][cr-box-overflow] uses the box's border box, so a sticky element inside a nested scroller shouldn't see the snapshot root (inference from the source). There is a catch in the same function: an effective root scroller uses `View()->ViewRect().size`, and [Blink may promote an element implicitly][cr-root-scroller-readme] when `ImplicitRootScrollerEnabled` is set. A promoted full-viewport scroller might show a larger shift, because this path has the size but not the offset. Whether that setting is enabled on Android Chrome was not established. Only the root scroller [causes browser controls movement][cr-root-scroller], so a non-promoted inner scroller would keep the toolbars from hiding. Cup [chose document scrolling on purpose][cup-shell], because iOS Safari ties pull-to-refresh to the document. This option would reverse that for a bug that only affects a transition.

### Options that don't help

- **`interactive-widget`:** it [concerns the keyboard][chrome-interactive-widget] (Chrome Android 108, Firefox Android 133, not Safari, per [browser-compat-data][bcd]). The toolbar outset in [`GetFixedToSnapshotViewportOutsets`][cr-outsets] doesn't depend on it, so it can't change the toolbar drop.
- **`window.snapshotRoot`:** a [proposal][csswg-8625] that has not shipped. It's absent from [browser-compat-data][bcd] and from Chromium's [`view_transition.idl`][cr-idl]. It would expose geometry and would only make compensation easier.
- **`position: fixed` with anchor positioning:** `position-anchor` is widely available ([browser-compat-data][bcd]: Chrome 151, Firefox 151, Safari 27), but it adds nothing to `position: fixed`, which already measures correctly. Our inference is that anchoring to a sticky box would inherit the sticky box's shift, and anchoring to an in-flow placeholder doesn't keep the bar at the screen's edge.

## Not established

- Whether a restricted Chromium issue covers this. The tracker was searched anonymously.
- Whether Firefox for Android or Safari shows the drop. Their source was only skimmed, and no device was used.
- Whether the ranking's untested options work: `:root { view-transition-name: none }` in particular needs one emulator run with the same setup as the measurements (top 56px, bottom 48px, tall page, scrolled, then the `top: 736px` probe, which should report 736).
- Which Blink step re-lays out sticky boxes when the flag flips, and whether sticky read this rect before Chrome 133.
- The five predictions in [the measurements section](#the-measurements-against-the-code), including the rising header.
- How the Capacitor shells behave. A WebView likely has no browser controls, which would mean no outsets, but this was not checked.

A report to the Chromium tracker has not been filed. The reduction above (a sticky probe, the `ViewRect` chain and the 680 versus 736 reading) would be enough to file one.

[archive-7859]: https://lists.w3.org/Archives/Public/public-css-archive/2022Oct/0320.html
[archive-8625]: https://lists.w3.org/Archives/Public/public-css-archive/2023Mar/0857.html
[bcd]: https://www.npmjs.com/package/@mdn/browser-compat-data/v/8.1.7
[chrome-bottom-bar]: https://blog.google/products-and-platforms/products/chrome/address-bar-position-change/
[chrome-interactive-widget]: https://developer.chrome.com/blog/viewport-resize-behavior
[cr-133]: https://github.com/chromium/chromium/tree/133.0.6943.0
[cr-133-outsets]: https://github.com/chromium/chromium/blob/133.0.6943.0/third_party/blink/renderer/core/view_transition/view_transition_style_tracker.cc#L1797-L1804
[cr-133-overflow]: https://github.com/chromium/chromium/blob/133.0.6943.0/third_party/blink/renderer/core/layout/layout_view.cc#L546-L550
[cr-133-sticky-rect]: https://github.com/chromium/chromium/blob/133.0.6943.0/third_party/blink/renderer/core/layout/layout_box.cc#L4184
[cr-133-viewrect]: https://github.com/chromium/chromium/blob/133.0.6943.0/third_party/blink/renderer/core/layout/layout_view.cc#L499-L543
[cr-9ede207]: https://github.com/chromium/chromium/commit/9ede207b263e6cc13f6894fffa60b3fb3e4806b1
[cr-box-overflow]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/layout/layout_box.cc#L2254-L2268
[cr-c92e6ce]: https://github.com/chromium/chromium/commit/c92e6ce7bc3f1b94a1b58fba7925fd98d758946c
[cr-contents-size]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/paint/paint_layer_scrollable_area.cc#L732-L746
[cr-eecfc51]: https://github.com/chromium/chromium/commit/eecfc51dd3960f2ab2cd3538157376d83cce17d4
[cr-idl]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/view_transition/view_transition.idl
[cr-is-root]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/view_transition/view_transition.h#L233-L236
[cr-is-transition]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/view_transition/view_transition_style_tracker.cc#L1980-L1988
[cr-main]: https://github.com/chromium/chromium/tree/0b2cf1183101fbc496ad178fa42ce588347b67c3
[cr-outsets]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/view_transition/view_transition_style_tracker.cc#L2042-L2067
[cr-overflow-clip]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/layout/layout_view.cc#L610-L614
[cr-readme]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/view_transition/README.md#viewport-sizes
[cr-root-flag]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/view_transition/view_transition_style_tracker.cc#L1065-L1067
[cr-root-scroller]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/page/scrolling/root_scroller_controller.h#L18-L22
[cr-root-scroller-readme]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/page/scrolling/README.md
[cr-sticky-constraints]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/layout/layout_box_model_object.cc#L660-L661
[cr-sticky-offset]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/page/scrolling/sticky_position_scrolling_constraints.cc#L104-L118
[cr-sticky-rect]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/layout/layout_box.cc#L4237-L4247
[cr-viewrect]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/layout/layout_view.cc#L553-L595
[cr-vt-test]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/renderer/core/view_transition/view_transition_test.cc
[cr-wpt-internal]: https://github.com/chromium/chromium/blob/0b2cf1183101fbc496ad178fa42ce588347b67c3/third_party/blink/web_tests/wpt_internal/view-transition/browser-controls-root-offset-new.html
[crbug-396091324]: https://issues.chromium.org/issues/396091324
[crbug-40252472]: https://issues.chromium.org/issues/40252472
[crbug-40281852]: https://issues.chromium.org/issues/40281852
[crbug-407785176]: https://issues.chromium.org/issues/407785176
[crbug-420743939]: https://issues.chromium.org/issues/420743939
[crbug-542796760]: https://issues.chromium.org/issues/542796760
[crbug-549552306]: https://issues.chromium.org/issues/549552306
[csswg-10197]: https://github.com/w3c/csswg-drafts/issues/10197
[csswg-7859]: https://github.com/w3c/csswg-drafts/issues/7859
[csswg-8625]: https://github.com/w3c/csswg-drafts/issues/8625
[cup-architecture]: https://github.com/patricktree/cup/blob/c08d786f34b87409badd1c7c254fb150fa7d3483/docs/architecture/web-app.md#routes-and-navigation
[cup-commit]: https://github.com/patricktree/cup/tree/c08d786f34b87409badd1c7c254fb150fa7d3483
[cup-cover]: https://github.com/patricktree/cup/blob/c08d786f34b87409badd1c7c254fb150fa7d3483/apps/web-app/src/app/cover-transition.ts
[cup-fade-footer]: https://github.com/patricktree/cup/blob/c08d786f34b87409badd1c7c254fb150fa7d3483/apps/web-app/src/app/components/fade-footer.ts
[cup-header]: https://github.com/patricktree/cup/blob/c08d786f34b87409badd1c7c254fb150fa7d3483/apps/web-app/src/app/components/main.tsx#L26-L31
[cup-index]: https://github.com/patricktree/cup/blob/c08d786f34b87409badd1c7c254fb150fa7d3483/apps/web-app/index.html
[cup-player-sheet]: https://github.com/patricktree/cup/blob/c08d786f34b87409badd1c7c254fb150fa7d3483/apps/web-app/src/app/components/player-sheet.tsx
[cup-research-vt]: recents-detail-view-transitions.md
[cup-shell]: https://github.com/patricktree/cup/blob/c08d786f34b87409badd1c7c254fb150fa7d3483/apps/web-app/src/routes/_shell.tsx
[dash-9ede207]: https://chromiumdash.appspot.com/fetch_commit?commit=9ede207b263e6cc13f6894fffa60b3fb3e4806b1
[dash-c92e6ce]: https://chromiumdash.appspot.com/fetch_commit?commit=c92e6ce7bc3f1b94a1b58fba7925fd98d758946c
[dash-eecfc51]: https://chromiumdash.appspot.com/fetch_commit?commit=eecfc51dd3960f2ab2cd3538157376d83cce17d4
[gecko-vt]: https://github.com/mozilla-firefox/firefox/blob/0b6146da78e50813404df3e74fe0dc29257252bc/dom/view-transitions/ViewTransition.cpp
[overflow]: https://drafts.csswg.org/css-overflow-3/#scrollport
[position]: https://drafts.csswg.org/css-position-3/
[position-sticky]: https://drafts.csswg.org/css-position-3/#stickypos-insets
[vt1]: https://drafts.csswg.org/css-view-transitions-1/
[vt1-capture]: https://drafts.csswg.org/css-view-transitions-1/#capture-the-image-algorithm
[vt1-scb]: https://drafts.csswg.org/css-view-transitions-1/#snapshot-containing-block-concept
[vt1-ua]: https://drafts.csswg.org/css-view-transitions-1/#ua-styles
[vt2]: https://drafts.csswg.org/css-view-transitions-2/
[vt2-scb]: https://drafts.csswg.org/css-view-transitions-2/#snapshot-containing-block-concept
[vt2-scoped]: https://drafts.csswg.org/css-view-transitions-2/#scoped-vt
[webkit-285400]: https://bugs.webkit.org/show_bug.cgi?id=285400
[webkit-320238]: https://bugs.webkit.org/show_bug.cgi?id=320238
[webkit-vt]: https://github.com/WebKit/WebKit/blob/30a6ac7cd2fb3f09380aa581d77ff9eba042febc/Source/WebCore/dom/ViewTransition.cpp
[wpt-no-root]: https://github.com/web-platform-tests/wpt/blob/7fd42b513e653557b7aaec963ba3e0da6a1f1b7f/css/css-view-transitions/no-root-capture.html
[wpt-tree]: https://github.com/web-platform-tests/wpt/tree/7fd42b513e653557b7aaec963ba3e0da6a1f1b7f/css/css-view-transitions
