# Design tokens and icons of the Recents and detail-view designs

> Historical research, incorporated 2026-10-28. [Spec #89](https://github.com/patricktree/cup/issues/89) took these values as its reference, and [#101](https://github.com/patricktree/cup/pull/101) (`8cccf1e`) built them into the web app's design system: the ink and page colors, Inter text styles scoped away from the global Space Mono rule, 12 px spacing, 24 px radii, the shadow and fades, and the eleven icons in [`icons/`](recents-design-tokens/icons/), now drawn as components in [`icons.tsx`](../../apps/web-app/src/app/design-system/icons.tsx). The [design-system story](../../apps/web-app/src/app/design-system/design-system.story.tsx) shows the current tokens; the [out-of-scope icons](recents-design-tokens/out-of-scope-icons/) wait for [issue #78](https://github.com/patricktree/cup/issues/78), and dark mode was not designed. Repository observations below describe `b70ebf4`.

[Original investigation](https://github.com/patricktree/cup/blob/7587d6e172e94b5a844a8dba0b4d4f0b51e0d3b5/docs/research/recents-design-tokens.md).

Research date: 2026-10-27, for [issue #84](https://github.com/patricktree/cup/issues/84) of the [Recents and detail view map](https://github.com/patricktree/cup/issues/79). The Figma file `Mud3jhH7Lliuv0jIbCS63R` was read through the Figma REST API (file version last modified 2026-10-27T16:09:21Z); repository observations are from `origin/main` at `b70ebf4`. The decisions belong to the spec ticket; this page records what the designs use and how it maps onto the web app's design system.

## Question

Extract what the seven Figma screens use (colors, typography, spacing, radii, shadows, and every icon, exported as SVG) and compare it with the web app's design-system tokens and components. Record which tokens and components exist, which need changing, and which are new, so the spec can name them.

## Answer

- **The palette is one ink color at five strengths on a warm off-white.** Text is `#121212` at 100%, 60%, 40% and 24%, with 8% and 4% for highlights and borders. Icons use a near-identical `#1e1e1e`. The page is `#f6f6f3`, surfaces are white, and skeletons and the scrubber track are opaque `#ececec`. Today's tokens are close but not equal: foreground `#1f1f1f`, background `#f2f2f2`, and emphasis steps at 65% and 45%.
- **Typography is Inter only, in nine named text styles plus five unnamed ones.** It needs 12, 20, 24 and 32 px sizes the app lacks, fixed line heights, and −2% letter spacing on medium-weight text. The app has no line-height or letter-spacing tokens, and it sets every `span` and `input` in Space Mono, which the redesigned screens must not inherit.
- **The geometry is a 12 px grid with 24 px radii.** Page inline padding, column and row gaps and card padding are 12 px (the app's inline padding is 16 px). Cards, covers and the active-segment highlight are rounded at 24 px; the mini player, skeleton bars and scrubber are fully rounded. The app's 4 px radius appears nowhere.
- **One shadow and one fade cover all elevation.** Cards and the mini player cast `4px -4px 20px rgb(0 0 0 / 12%)`; the input already uses the same shadow with a downward offset. The tab bar and the player sheet sit on a transparent-to-white vertical gradient instead of a solid bar.
- **Covers are about 5:3, not 1.91:1.** Card covers are 183×110 px and the detail cover 377×226 px, both ≈1.67:1, full-bleed at the card's bottom. The mini player shows the cover as a 41 px circle. This refines [How should Recents cards get their cover images?](https://github.com/patricktree/cup/issues/83), which assumed 1.91:1 without having read the frames.
- **Eleven icons are in scope, all exported as SVG.** They replace the three Lucide icons in the reader and the floating player. The bookmark and Library icons are exported separately because they are out of scope.
- **Existing components cover only the Add dialog.** `DSDialog`, `DSInput` and `DSButton` carry the dialog, which Figma does not draw. Everything else on these screens is new: avatar, tab bar, Recents card, mini player, player sheet, detail top bar, active-segment highlight, skeleton bars and an icon button.
- **Several states are not drawn**: active versus inactive tabs, an enabled play icon, hover, focus and pressed states, the "…" menu, the Add dialog, and the tab bar with two tabs instead of three. The spec has to settle them or derive them from the drawn ones.

## Method

One `GET /v1/files/:key/nodes` request fetched the seven frames, and one `GET /v1/images/:key?format=svg&svg_outline_text=true&svg_simplify_stroke=true` request exported fourteen icon nodes. A Node script walked each frame and printed every visible node with its size, fills, strokes, radii, effects, auto-layout gaps and paddings, and text style; a second script read the article body's character-style overrides, the gradients and the stroke caps. The scripts, the raw API response and the printed outline are in [`recents-design-tokens.tar.xz`](recents-design-tokens.tar.xz).

| Frame                                                                                                           | Node       | Size     |
| --------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| [Recents, filled](https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=260-1395)                     | `260:1395` | 402×1379 |
| [Recents, one ready item](https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=260-2009)             | `260:2009` | 402×898  |
| [Recents, empty](https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=260-2229)                      | `260:2229` | 402×898  |
| [Recents, pending with mini player](https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=370-5944)   | `370:5944` | 402×898  |
| [Detail view, play at start](https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=338-1150)          | `338:1150` | 402×2850 |
| [Detail view, scrolled while playing](https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=338-1253) | `338:1253` | 402×2470 |
| [Detail view, loading (trial)](https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=357-2150)        | `357:2150` | 402×898  |

The frames are drawn for a 402 pt wide iPhone and include an iOS status bar instance; the status bar is device chrome and is left out below. Many auto-layout frames carry Figma's default 10 px gap around a single child, where the gap has no effect; only gaps between two or more children are listed.

## Colors

The file defines one color style, `System Background/Dark Base/Primary` (`#000000`), and it is used only by the iOS status bar. Every other color is a raw value; the table lists each one with where it appears.

| Figma value               | Where                                                                              | Web app today                                                | Verdict                                |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------- |
| `#f6f6f3`                 | Page background of every frame; detail article container                           | `--color-bg` = `--color-white` = `#f2f2f2`                   | Change                                 |
| `#121212`                 | Headings, card titles, mini player title, active segment text                      | `--color-fg` = `--color-black` = `hsl(0 0% 12%)` = `#1f1f1f` | Change                                 |
| `#1e1e1e`                 | Icons, avatar ring, avatar initials, scrubber progress                             | `#1f1f1f` (same token as text)                               | Exists, within 1/255; see below        |
| `#121212` at 60%          | Article body, tab labels, empty-state text, elapsed and remaining time             | `--color-fg-emphasized-sm` = `#1f1f1f` at 65%                | Change                                 |
| `#121212` at 40%          | Source host, pending card title, mini player host                                  | `--color-fg-emphasized-xs` = `#1f1f1f` at 45%                | Change                                 |
| `#121212` at 24%          | Disabled player sheet controls (loading)                                           | none                                                         | New                                    |
| `#121212` at 8%           | Active-segment highlight                                                           | Reader skeleton inline `hsl(var(--color-black-hsl) / 12%)`   | New token                              |
| `#121212` at 4%           | 1 px border of cards and the mini player                                           | none                                                         | New                                    |
| `#ffffff`                 | Card and mini player surface; end color of the bottom fades                        | `--color-input-bg` = `#fff`                                  | Exists; rename to a surface token      |
| `#ececec`                 | Skeleton bars, cover placeholder, scrubber track                                   | none (skeleton uses 12% black)                               | New                                    |
| `#ffffff00` → `#ffffff`   | Tab bar fade (opaque from 54%), player sheet fade (opaque from 35%), top to bottom | none                                                         | New                                    |
| `--color-error` `#b42318` | Not in the designs                                                                 | Failure notices, toasts, input errors                        | Keep for the undesigned failure states |

Text ink `#121212` and icon ink `#1e1e1e` differ by 12/255 per channel, invisible at icon stroke widths. One foreground token for both is simpler; the exported SVGs hard-code `#1E1E1E`, so they need `currentColor` if icons should follow a token. Dark mode is neither drawn nor implemented.

## Typography

The file defines nine text styles. Figma reports letter spacing as a percentage; the px values below are what the nodes resolve to.

| Style       | Figma description                          | Inter weight | Size / line height | Letter spacing | Used for                                                  |
| ----------- | ------------------------------------------ | ------------ | ------------------ | -------------- | --------------------------------------------------------- |
| `H1`        | none                                       | 500          | 32 / 24 px         | −2% (−0.64 px) | "Recent" screen title                                     |
| `H2`        | e.g. Article Headings                      | 500          | 24 / 26 px         | −2% (−0.48 px) | Detail title                                              |
| `H3`        | Card Titles                                | 500          | 18 / 20 px         | −2% (−0.36 px) | Card title; pending card's phase line                     |
| `H4`        | Subheadings                                | 500          | 18 / 22 px         | 0              | Detail subtitle (out of scope)                            |
| `H5`        | Header Mini Player                         | 500          | 16 / 24 px         | −2% (−0.32 px) | Mini player title; phase line in the loading player sheet |
| `Paragraph` | e.g. Article Body                          | 400          | 18 / 32 px         | 0              | Article body; links are underlined, same color            |
| `Tagline`   | none                                       | 400          | 14 / 14 px         | 0              | Source host under cards and in the detail view            |
| `Label`     | Labels for Navbar, Tagline for Mini Player | 500          | 12 / 12 px         | −2% (−0.24 px) | Tab labels; mini player host                              |

Five texts use no style:

| Text                                | Inter weight | Size / line height | Letter spacing | Nearest style           |
| ----------------------------------- | ------------ | ------------------ | -------------- | ----------------------- |
| Avatar initials ("vh")              | 500          | 24 / 36 px         | −0.48 px       | `H2` size               |
| Empty state ("Don't be shy! …")     | 500          | 20 / 24 px         | −0.40 px       | none (only 20 px text)  |
| Compact title in the detail top bar | 500          | 14 / 14 px         | 0              | `Tagline` at weight 500 |
| Elapsed and remaining time          | 400          | 12 / 36 px         | −0.24 px       | `Label` at weight 400   |
| "15" inside the skip icons          | 500          | 16 / 24 px         | −0.32 px       | Outlined in the SVGs    |

`H1`'s line height is smaller than its size; on a single-line title that only shrinks the box, but a spec should use a line height of at least 1 so wrapped or zoomed text does not overlap.

| Aspect         | Designs                           | Web app today                                                                                                                        | Verdict                                                                       |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Font family    | Inter only                        | `--font-family-1` Inter Variable; `--font-family-2` Space Mono on every `span` and `input` (`cssBase`) and in `conversion-shell.tsx` | Exists; the global Space Mono rule must not reach the new screens             |
| Sizes          | 12, 14, 16, 18, 20, 24, 32 px     | `--font-size-sm` 14, `-md` 16, `-lg` 18, `-xl` 22, `-xxl` 26, `-xxxl` 30, `-display` 36                                              | 14, 16, 18 exist; 12, 20, 24, 32 are new; 22 and 26 are unused anywhere today |
| Weights        | 400, 500                          | Default 400; `--font-weight-inter-figma-medium` 500                                                                                  | Exist                                                                         |
| Line heights   | 12, 14, 20, 22, 24, 26, 32, 36 px | Reset sets `line-height: 1.5`; only `--line-height-display` 55 px                                                                    | New, per text style                                                           |
| Letter spacing | −2% on medium headings and labels | none                                                                                                                                 | New                                                                           |
| Numerals       | Time labels                       | Floating player time uses `font-variant-numeric: tabular-nums`                                                                       | Keep tabular numerals                                                         |

## Spacing, sizes and radii

| Measure                  | Value                                                                                                                          | Web app today                                                                     | Verdict                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Page inline padding      | 12 px (grid, detail content, mini player container)                                                                            | `--app-padding-inline` 16 px                                                      | Change, or a separate token for the new screens |
| Header row               | 44 px tall; title at 24 px from the left, 8 px bottom padding; avatar at the right edge minus 14 px                            | none                                                                              | New                                             |
| Grid                     | 24 px above the first row; 12 px column and row gaps; two 183 px columns at 402 px                                             | none ([masonry decided separately](https://github.com/patricktree/cup/issues/82)) | New                                             |
| Card                     | 12 px top padding; title block 12 px inline padding; 24 px between title and cover                                             | none                                                                              | New                                             |
| Host line under a card   | 10 px padding around a 14 px `Tagline`                                                                                         | none                                                                              | New                                             |
| Mini player              | 56 px pill; 10–12 px from the screen edges (the two frames differ); padding 8 / 24 / 8 / 8 px; 8 px gaps; controls 16 px apart | Floating player bar with `--spacing-base` gaps                                    | New                                             |
| Player sheet             | 305 px fade; padding 32 / 24 px; 8 px track inside a 24 px hit row; controls 64 px apart                                       | Floating player with a native range input                                         | New                                             |
| Detail top bar           | 40 px row; back chevron, 4 px gap between compact title and host, "…" in a 51×28 px button                                     | `BackLink` with Lucide `ArrowLeft`                                                | New                                             |
| Detail content           | Cover with 24 px above and below; 12 px between title, subtitle and host                                                       | Reader layout                                                                     | New                                             |
| Active-segment highlight | Extends 12 px past the text on both sides, radius 24 px                                                                        | `[aria-current="true"]` turns the segment medium weight                           | Change                                          |
| Tab bar                  | 194 px fade; padding 32 / 24 px; items 80 px apart; 24 px icon, 4 px gap, 12 px label                                          | none                                                                              | New                                             |
| Radius 24 px             | Cards, covers, active-segment highlight                                                                                        | `--border-radius-lg` 24 px (dialog)                                               | Exists                                          |
| Fully rounded            | Mini player, mini player cover, skeleton bars, scrubber track                                                                  | Input inline `999px`                                                              | New token                                       |
| Radius 4 px              | not used                                                                                                                       | `--border-radius-sm` (buttons, toasts, reader notices)                            | Keep for existing parts                         |

The 12 px rhythm sits off the app's 8 px `--spacing-base`, as 1.5 units; 4, 8, 16, 24 and 32 px fit it, while 10 px (host line, mini player inset) does not.

## Elevation and fades

| Effect      | Figma value                                                                              | Where                 | Web app today                                    | Verdict                                               |
| ----------- | ---------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| Drop shadow | `4px -4px 20px rgb(0 0 0 / 12%)`                                                         | Cards, mini player    | `DSInput` inline `4px 4px 20px rgb(0 0 0 / 12%)` | New token; the input differs only in offset direction |
| Card border | 1 px `#121212` at 4%, centered on the edge                                               | Cards, mini player    | none                                             | New                                                   |
| Bottom fade | Linear, top to bottom, transparent white to white at 54% (tab bar) or 35% (player sheet) | Tab bar, player sheet | none                                             | New                                                   |

The negative y offset casts the shadow upward and to the right. Whether that is deliberate or a sign slip is for the spec to confirm; the input's existing shadow points down.

## Icons

All icons are drawn by hand in the file, as the map's Notes require, and are exported unchanged with their text outlined. Node ids point at the instance each file came from.

| File                                                                         | Size  | Node       | Where                                        | Replaces                                            |
| ---------------------------------------------------------------------------- | ----- | ---------- | -------------------------------------------- | --------------------------------------------------- |
| [`avatar-ring.svg`](recents-design-tokens/icons/avatar-ring.svg)             | 54×49 | `260:1411` | Ring around the avatar initials, 4 px stroke | none                                                |
| [`tab-recent.svg`](recents-design-tokens/icons/tab-recent.svg)               | 24×24 | `260:1882` | Recent tab (filled house)                    | none                                                |
| [`tab-add.svg`](recents-design-tokens/icons/tab-add.svg)                     | 24×23 | `260:1847` | Add tab (outlined plus)                      | none                                                |
| [`back-chevron.svg`](recents-design-tokens/icons/back-chevron.svg)           | 19×25 | `338:1158` | Detail top bar, 3 px stroke                  | Lucide `ArrowLeft` in the reader route              |
| [`more.svg`](recents-design-tokens/icons/more.svg)                           | 51×28 | `377:7818` | "…" menu button, including its padding       | none                                                |
| [`skip-back-15-mini.svg`](recents-design-tokens/icons/skip-back-15-mini.svg) | 36×36 | `377:7791` | Mini player −15 s                            | Floating player's compact controls                  |
| [`pause-mini.svg`](recents-design-tokens/icons/pause-mini.svg)               | 32×32 | `260:2877` | Mini player pause                            | Lucide `Pause` in the floating player               |
| [`skip-back-15.svg`](recents-design-tokens/icons/skip-back-15.svg)           | 36×36 | `357:2134` | Player sheet −15 s                           | Floating player's full controls                     |
| [`skip-forward-15.svg`](recents-design-tokens/icons/skip-forward-15.svg)     | 36×36 | `357:2142` | Player sheet +15 s (mirrored arrow)          | Floating player's full controls                     |
| [`pause.svg`](recents-design-tokens/icons/pause.svg)                         | 48×48 | `357:2138` | Player sheet pause                           | Lucide `Pause`                                      |
| [`play-disabled.svg`](recents-design-tokens/icons/play-disabled.svg)         | 48×48 | `357:2299` | Player sheet play, disabled (24% opacity)    | Lucide `Play` in the floating player and the reader |

The two −15 s icons draw the same glyph at the same size and differ only in clip-path ids, so one file serves both. No enabled play icon is drawn: the only play icon is the disabled one in the loading frame, whose path at full opacity is the obvious enabled state, and the mini player shows only pause. The Recent tab is drawn filled and the Add tab outlined, with identical label colors, so the frames do not show which tab is active.

Lucide `X` in `DSToast` stays; toasts are not in the designs. `lucide-react` stays a dependency for it unless the spec draws a close icon.

Out of scope, exported for completeness only ([Bookmark audiobooks and list them in a Library tab](https://github.com/patricktree/cup/issues/78)): [`tab-library.svg`](recents-design-tokens/out-of-scope-icons/tab-library.svg) (`260:1870`), [`card-bookmark.svg`](recents-design-tokens/out-of-scope-icons/card-bookmark.svg) (`260:1741`) and [`card-bookmark-filled.svg`](recents-design-tokens/out-of-scope-icons/card-bookmark-filled.svg) (`260:1900`). The cards, the player sheet and the third tab carry them in the frames.

## Components

| Component                  | Status           | Notes                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DSDialog`                 | Exists, reuse    | Carries the Add dialog, which Figma does not draw. Its 24 px radius matches the cards; its background follows `--color-bg`.                                                                                                                                                                                                                                                   |
| `DSInput`                  | Exists, reuse    | The pill input with the 12% shadow already matches the new elevation language for the Add dialog's URL field.                                                                                                                                                                                                                                                                 |
| `DSButton`                 | Exists, change   | The designs have no text buttons outside the undesigned dialog. Back, "…", tab items and player controls are icon-only buttons with no padding or border; `variant="text"` is closest but keeps padding and a 4 px radius. An icon-button variant or a separate `DSIconButton` with a hit area of at least 44 px is new.                                                      |
| `DSButtonGroup`, `DSToast` | Exist, unchanged | Not in the designs.                                                                                                                                                                                                                                                                                                                                                           |
| Avatar                     | New              | Initials in `avatar-ring.svg`, 24 px medium text, linking to the account page.                                                                                                                                                                                                                                                                                                |
| Tab bar and tab item       | New              | Fade background, icon over 12 px `Label`; account shell pages only. Laid out for three items; two-tab spacing is undesigned.                                                                                                                                                                                                                                                  |
| Recents card               | New              | White surface, border, shadow, 24 px radius, `H3` title, full-bleed 5:3 cover, host line outside the card. Pending variant: title replaced by the phase line at 40%. The muted lines for undesigned states use the same slot.                                                                                                                                                 |
| Masonry grid               | New              | Two columns, 12 px gaps; technique from [Which masonry technique keeps newest-first order in iOS Safari, Android WebView, and Chrome?](https://github.com/patricktree/cup/issues/82).                                                                                                                                                                                         |
| Mini player                | New              | Replaces the floating player's compact controls.                                                                                                                                                                                                                                                                                                                              |
| Player sheet               | New              | Replaces the floating player's full controls; scrubber with an 8 px `#ececec` track, an 8 px round-capped `#1e1e1e` progress line and no visible thumb. The native `<input type="range">` with `accent-color` cannot draw that without custom styling; Base UI's `Slider` (already a dependency through `@base-ui/react`) can. Disabled state: controls at 24%, times `-:--`. |
| Detail top bar             | New              | Back chevron, compact title (14 px medium) and host once scrolled, "…" menu button. The menu itself is undesigned; Base UI's `Menu` fits.                                                                                                                                                                                                                                     |
| Active-segment highlight   | Change           | Today the active segment turns medium weight. The design keeps weight 400, raises the segment from 60% to 100% ink and puts an 8% rounded background behind it, so the body text is dimmed to 60% by default.                                                                                                                                                                 |
| Skeleton                   | Change           | `ReaderSkeleton` uses 12% black blocks with 6 px radii. The design uses `#ececec`: a 24 px radius cover block and fully rounded 24 px bars in pairs, 12 px apart.                                                                                                                                                                                                             |
| Cover image                | New              | 5:3 box with `object-fit: cover`, 24 px radius in the detail view, clipped by the card at the bottom of a card, 41 px circle in the mini player.                                                                                                                                                                                                                              |

## Undesigned states

The spec has to decide these or derive them from the drawn frames:

- Active and inactive tab states, and the two-tab layout.
- Enabled play icon (derivable from `play-disabled.svg` at full opacity) and the mini player's play state.
- Hover, focus-visible and pressed states for cards, tabs and every icon button.
- The "…" menu and the Add dialog (the dialog reuses `DSDialog`).
- Wider screens; the map's Notes already settle more grid columns and a centered reader.
- Dark mode.
