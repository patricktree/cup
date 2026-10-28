# Web application screens

The shared web application, which the Capacitor shells also render, gives signed-in listeners two account pages, Recents and the account page, and gives every audiobook a detail view. User-facing copy calls an audiobook a track ([glossary](../GLOSSARY.md#audiobook)). This page covers how the screens relate, which data they rely on and which rules span them; the [web application guide](../../apps/web-app/README.md) covers development, and [playback](conversion.md#playback) covers the one player behind every screen.

## Routes and navigation

- **Home and Recents.** A signed-in listener on `/` is redirected to Recents (`/recent`), and a signed-out listener on `/recent` back to `/`, whose start form is unchanged. Two cases keep a signed-in listener on `/` or send them elsewhere: a start submitted on the home page that is still pending, resumed after OAuth or waiting out a rate limit, finishes there ([resuming after sign-in](authentication.md#resuming-a-conversion-after-sign-in)), and a shared URL that waits for a form goes to the Add dialog. There is no `/history` route and no redirect from it.
- **Add dialog.** Adding a track is the child route `/recent/add`, rendered over Recents. A [route mask](../../apps/web-app/src/app/global-providers.tsx) keeps the URL bar on `/recent`, and a reload keeps the dialog open. Opening it from the app pushes a history entry, so Back closes it. The close button, Escape, a press outside and a successful start all leave the same way: back one entry when the app opened the dialog, otherwise, as after a share, replace the entry with `/recent`. Sign-in, the rate-limit countdown and start errors stay inside the dialog, and its request lives only while it is open, so it never resumes on the home page.
- **Share intake.** A URL shared to the app while an account is signed in opens the Add dialog with the URL filled in and nothing submitted, on Android and iOS alike. Signed out, intake is unchanged: the home page, or the last trial whose credential was exchanged ([mobile guide](../../apps/mobile-app/README.md#android-app-links-and-sharing)).
- **Detail view.** `/audiobooks/{conversionId}` serves account and trial audiobooks with the same view. Its back target is Recents when an account is signed in and `/` otherwise; trial pages show no account chrome.

The [routing E2E tests](../../qa/e2e/test-e2e/routing.test.ts) cover the redirects, the retired `/history` route and the masked dialog URL; the [Recents route tests](../../apps/web-app/src/routes/_shell.recent.test.ts) cover closing the dialog and signed-in share intake.

## Recents

Recents lists the account's history newest first, one card per conversion, each linking to the detail view.

- **Card states.** Every conversion with a narration document (synthesizing, insufficient duration, ready, ready with failed segments) looks ready: its title, then its cover when there is one. A pending conversion shows its [preparation phase](../GLOSSARY.md#preparation-phase) in the title's place, and a failed one a short failure line. The source host sits below every card; the detail view explains the state.
- **Masonry order.** The cards are one newest-first list on a CSS grid with 1 px rows; [`useMasonryRowSpans`](../../apps/web-app/src/app/use-masonry-row-spans.ts) sets each card's row span from its measured height, and grid auto-placement puts it in the shortest column. Reading, focus and screen-reader order therefore follow the visual order, left to right and top down, and an appended page moves no existing card. Any card whose height changes re-places the cards after it, so covers reserve their space with a fixed 5:3 crop and no stored dimensions; a pending card turning ready reshuffles the grid once. Two columns fit a phone, and container queries add columns on wider screens. The [masonry research](../research/recents-masonry-layout.md) explains why neither CSS `grid-lanes` nor multi-column fits yet.
- **Paging and polling.** There is no "Load more" button: a [sentinel](../../apps/web-app/src/app/use-is-in-scroll-reach.ts) within about one screen of the list's end loads the next page while one exists; a failed page waits for an explicit Retry. The history query refreshes every 5 seconds while any listed conversion is pending.
- **Covers.** A ready history item with a cover carries its own [signed media URL](authentication.md#signed-media-url), so cards need no audiobook request each. Because the URL stays identical for a UTC day and the browser caches covers for a day ([ADR 0013](../adr/0013-cache-cover-images-in-the-browser-for-a-day.md)), polls and app starts do not download covers again. The [cover component](../../apps/web-app/src/app/design-system/cover-image.tsx) keeps showing the previous image until a changed URL has loaded.

The same Recents route tests cover the order, paging and card states.

## Detail view

The [detail view](../../apps/web-app/src/routes/_shell.audiobooks.$conversionId.tsx) polls the audiobook every second while it is pending or synthesizing and shows the document, readable in every state after preparation, above the [player sheet](conversion.md#playback).

- **Top bar.** A back chevron and a "…" menu that opens the source page and offers Retry whenever the audiobook can generate. Once the title scrolls out of view, a compact title and host fade in.
- **Status line.** Above the player sheet: the preparation phase while pending, the count of segments with audio while synthesizing, and empty otherwise. An unknown or missing phase reads "Preparing"; the client parses the phase tolerantly ([ADR 0010](../adr/0010-tolerate-unknown-keys-at-the-listener-api.md)).
- **Notices.** Insufficient duration, finally failed segments and a retry refused for duration are notices with Retry; the [conversion page](conversion.md#whole-document-synthesis-and-accounting) holds what each state means.
- **States without a document.** Loading and pending show skeleton bars and a disabled player sheet; a failed preparation shows the source host as title, the explanation and Retry.
- **Active segment.** While its audiobook is loaded, the current synchronization unit is marked `aria-current` and highlighted in the text, driven by the player's timeline.

The [detail view tests](../../apps/web-app/src/routes/_shell.audiobooks.$conversionId.test.ts) cover these states.

## Account chrome

- **Tab bar.** Recents and the account page show a [tab bar](../../apps/web-app/src/app/components/account-tab-bar.tsx) with Recent and Add. Add opens the Add dialog and never shows as the current page. Detail views and trial pages have no tab bar.
- **Avatar.** The Recents header links to the account page through an [avatar](../../apps/web-app/src/app/components/account-avatar.tsx) with the account holder's initials. The name comes from the Supabase session's `user_metadata.name`, else `full_name`, which Supabase fills from the Google sign-in and refreshes on each sign-in; Cup stores no name, so account erasure has none to remove. [`toAvatarInitials`](../../apps/web-app/src/app/avatar-initials.ts) takes the first letter of the first and the last whitespace-separated word; without a usable name the avatar shows a person glyph. The [name research](../research/avatar-initials-name-source.md) records why Supabase gives no separate first and last name.
- **Mini player.** The account pages control the loaded audiobook through the [mini player](../../apps/web-app/src/app/components/mini-player.tsx) above the tab bar; [playback](conversion.md#playback) describes it and the player sheet.

The [design-system story](../../apps/web-app/src/app/design-system/design-system.story.tsx) shows the tokens, text styles, icons and components of these screens, and the [web application's agent guide](../../apps/web-app/AGENTS.md) holds the conventions for using them.

## Unknowns

- The masonry's `ResizeObserver` spans have no automated WebKit coverage: Playwright runs Chromium only, and iOS Safari is checked by hand.
- Covers and the narration track are likely blocked in the Capacitor shells, because media routes send `Cross-Origin-Resource-Policy: same-origin` to pages on `capacitor://localhost` and `https://localhost`. This is inferred from the header and untested; shell playback is native-app work.
- That an Android native Google sign-in stores `user_metadata.name` was read from source, not observed on a device.
