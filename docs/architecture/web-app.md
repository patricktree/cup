# Web application screens

The shared web application, which the Capacitor shells also render, gives signed-in listeners Recents, with the Add and account dialogs over it, gives a listener whose account deletion is scheduled an account recovery page, and gives every audiobook a detail view. User-facing copy calls an audiobook a track ([glossary](../GLOSSARY.md#audiobook)). This page holds what spans the screens; each screen's own behaviour is in its route, its tests and its stories, and [playback](conversion.md#playback) covers the one player behind every screen.

## Routes and navigation

- **Home and Recents.** A signed-in listener on `/` is redirected to Recents (`/recent`), and a signed-out listener on `/recent` or one of its dialogs back to `/`. Two cases keep a signed-in listener off that redirect: a start submitted on the home page that is still pending, resumed after OAuth or waiting out a rate limit, finishes there ([resuming after sign-in](authentication.md#resuming-a-conversion-after-sign-in)), and a URL shared while signed in goes to the Add dialog instead.
- **Add dialog.** Adding a track is the child route `/recent/add`, rendered over Recents and [masked](../../apps/web-app/src/app/global-providers.tsx) so the URL bar keeps `/recent`. Its start request lives only while the dialog is open, apart from the home page's stored request, so a dialog start never resumes on the home page.
- **Account dialog.** The avatar on Recents opens the account settings as the child route `/recent/account`, rendered over Recents like the Add dialog but not masked: confirming a deletion or recovery signs in with Google again, and that sign-in returns to the path in the URL bar, where the dialog has to reopen with the confirmation step.
- **Account recovery.** `/account-recovery` restores an account whose deletion is scheduled, and the scheduled-deletion email links it. Scheduling deletion signs the listener out, so unlike the account dialog, this page offers sign-in itself, and it shows no account chrome. Its Google confirmation returns to it the same way. For an active account it only links to Recents.
- **Detail view.** `/audiobooks/{conversionId}` serves account and trial audiobooks with one view. Its back target is Recents when an account is signed in and `/` otherwise; trial pages show no account chrome.

The [routing E2E tests](../../qa/e2e/test-e2e/routing.test.ts) and the [Recents route tests](../../apps/web-app/src/routes/_shell.recent.test.ts) pin these paths, including closing the dialogs and signed-in share intake.

## Recents covers and order

Recents is one newest-first list on a CSS grid with 1 px rows; [`useMasonryRowSpans`](../../apps/web-app/src/app/use-masonry-row-spans.ts) gives each card a row span from its measured height, so reading, focus and screen-reader order follow the visual order and an appended page moves no existing card. Any card whose height changes re-places the cards after it, which is why covers are cropped to a fixed 5:3 with no stored dimensions. The [masonry research](../research/recents-masonry-layout.md) explains why neither CSS `grid-lanes` nor multi-column fits yet.

A ready history item carries its cover's own [signed media URL](authentication.md#signed-media-url), identical for a UTC day and cached by the browser for a day ([ADR 0013](../adr/0013-cache-cover-images-in-the-browser-for-a-day.md)), so polls and app starts download no cover again.

## Account holder's name

The avatar's initials come from the Supabase session's `user_metadata.name`, else `full_name`, which Supabase fills from the Google sign-in and refreshes on each sign-in. Cup stores no name, so account erasure has none to remove.

## Unknowns

- The masonry's `ResizeObserver` spans have no automated WebKit coverage: Playwright runs Chromium only, and iOS Safari is checked by hand.
- Covers and the narration track are likely blocked in the Capacitor shells, because media routes send `Cross-Origin-Resource-Policy: same-origin` to pages on `capacitor://localhost` and `https://localhost`. This is inferred from the header and untested; shell playback is native-app work.
- That an Android native Google sign-in stores `user_metadata.name` was read from source, not observed on a device.
