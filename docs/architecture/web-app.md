# Web application screens

The shared web application, which the Capacitor shells also render, gives signed-in listeners Recents, with the Add and account dialogs over it, gives a listener whose account deletion is scheduled an account recovery page, and gives every audiobook a detail view. User-facing copy calls an audiobook a track ([glossary](../GLOSSARY.md#audiobook)). This page holds what spans the screens; each screen's own behaviour is in its route, its tests and its stories, and [playback](conversion.md#playback) covers the one player behind every screen.

## Routes and navigation

- **Home and Recents.** A signed-in listener on `/` is redirected to Recents (`/recent`), and a signed-out listener on `/recent` or one of its dialogs back to `/`. Two cases keep a signed-in listener off that redirect: a start submitted on the home page that is still pending, resumed after OAuth or waiting out a rate limit, finishes there ([resuming after sign-in](authentication.md#resuming-a-conversion-after-sign-in)), and a URL shared while signed in goes to the Add dialog instead.
- **Add dialog.** Adding a track is the child route `/recent/add`, rendered over Recents and [masked](../../apps/web-app/src/app/global-providers.tsx) so the URL bar keeps `/recent`. Its start request lives only while the dialog is open, apart from the home page's stored request, so a dialog start never resumes on the home page.
- **Account dialog.** The avatar on Recents opens the account settings as the child route `/recent/account`, rendered over Recents like the Add dialog but not masked: confirming a deletion or recovery signs in with Google again, and that sign-in returns to the path in the URL bar, where the dialog has to reopen with the confirmation step.
- **Account recovery.** `/account-recovery` restores an account whose deletion is scheduled, and the scheduled-deletion email links it. Scheduling deletion signs the listener out, so unlike the account dialog, this page offers sign-in itself, and it shows no account chrome. Its Google confirmation returns to it the same way. For an active account it only links to Recents.
- **Detail view.** `/audiobooks/{conversionId}` serves account and trial audiobooks with one view; trial pages show no account chrome. For a track the account history lists, its menu deletes the track after a confirmation, unloading it from the player first ([conversion deletion](conversion-deletion.md)); a trial track a signed-in listener can open offers no deletion.
- **Back to Recents.** Every in-app link on Recents, the cards, the mini player, the avatar and the Add tab, marks the entry it pushes as opened from Recents (the `isOpenedFromRecents` history state). Leaving a screen so marked goes back one history entry, so Recents returns at the listener's scroll position, as the Android back button and swipe-back do: the detail view's Back control, a successful deletion, and closing either dialog. Without the mark, after a deep link, a cold start, a start from home after sign-in, or a share, there is no Recents entry below to return to: the detail view's Back pushes `/recent`, which opens at the top, and a deletion or a dialog close replaces the entry with `/recent`. Back after a deletion therefore never returns to the deleted track; going back leaves it as the browser's Forward entry, which leads to the not-found error screen, and that is accepted. A trial listener's Back is a plain link to `/`. Recents restores the scroll position in the render it returns with, because [`useMasonryRowSpans`](../../apps/web-app/src/app/use-masonry-row-spans.ts) measures the cards before the 1 px rows apply.

The [routing E2E tests](../../qa/e2e/test-e2e/routing.test.ts), the [Recents route tests](../../apps/web-app/src/routes/_shell.recent.test.ts) and the [detail view tests](../../apps/web-app/src/routes/_shell.audiobooks.$conversionId.test.ts) pin these paths, including closing the dialogs, Back and deletion with and without the mark, and signed-in share intake.

## Recents covers and order

Recents is one newest-first list on a CSS grid with 1 px rows; [`useMasonryRowSpans`](../../apps/web-app/src/app/use-masonry-row-spans.ts) gives each card a row span from its measured height, so reading, focus and screen-reader order follow the visual order and an appended page moves no existing card. Any card whose height changes re-places the cards after it, which is why covers are cropped to a fixed 5:3 with no stored dimensions. The [masonry research](../research/recents-masonry-layout.md) explains why neither CSS `grid-lanes` nor multi-column fits yet.

A ready history item carries its cover's own [signed media URL](authentication.md#signed-media-url), identical for a UTC day and cached by the browser for a day ([ADR 0013](../adr/0013-cache-cover-images-in-the-browser-for-a-day.md)), so polls and app starts download no cover again.

## Account holder's name

The avatar's initials come from the Supabase session's `user_metadata.name`, else `full_name`, which Supabase fills from the Google sign-in and refreshes on each sign-in. Cup stores no name, so account erasure has none to remove.

## Query cache

[ADR 0016](../adr/0016-keep-the-query-cache-for-the-page-lifetime-and-load-screens-in-route-loaders.md) records why the cache lives for the page lifetime, why routes await their data, and why links preload once in view.

Every screen reads server data through the TanStack Query cache, whose [key factories](../../apps/web-app/src/data-fetching/query-keys.ts) group keys by owner: everything of the signed-in account sits under `["account", subject]`, next to each audiobook and each grant.

**Returning to a screen shown earlier never shows a loading state.** The [query client](../../apps/web-app/src/data-fetching/query-client.ts) keeps every query for the page lifetime and treats it as stale at once, so a returning screen shows the cached content and requests it again. Data leaves the cache only through `queryClient.clear()` on sign-out or an account switch, or an explicit removal. No screen stays mounted while hidden: polling runs only while its screen is shown, and returning requests the data once and polls again.

The cache must never show the listener something false, including on a screen they return to, so every API write lives in `src/data-fetching/` and, once it succeeds, invalidates by key prefix every query whose server data it may change. It edits the cache itself only where the listener would see or act on stale data before the refetch returns, cancels that query's requests in flight first, and still invalidates afterwards. The direct edits:

- **Deleting a conversion** removes it from the cached history before leaving its detail view, then drops its audiobook and invalidates the account.
- **Saving a signed-in listener's listening position** writes it into the cached audiobook and marks it stale without requesting it, since playback saves every few seconds.
- **Exchanging a trial link's credential** caches the grant it answers with.

A direct edit keeps the cached audiobook's arrival time, which dates its narration track URL for [renewal](authentication.md#signed-media-url). A refetch of shown data answered with _not found_ or _access denied_ drops the cached data, so the screen shows its error screen; other failures keep the content and report a toast. The [web app README](../../apps/web-app/README.md#component-tests-and-visual-coverage) names the tests that guard revisits.

## Where screens load

Every route whose screen shows server data or branches on auth loads in the route, so the router can keep the previous screen in view and owns the pending and error UI:

- **Auth settles in `beforeLoad`.** A route that needs the account awaits [`settleAccountSession`](../../apps/web-app/src/auth/account-session.ts) and redirects a signed-out listener with `replace`. Recents puts only the signed-in `subject` into the router context, for its loader and its dialogs. Home redirects a signed-in listener to Recents before the start form renders, and treats an auth failure as signed out.
- **The loader awaits the critical query and returns nothing.** It reads with `queryClient.query({ ...options, staleTime: 'static' })` (or `infiniteQuery` for the history), so cached data returns at once even when stale.
- **The component observes the same query through a suspense hook**, never `Route.useLoaderData`, so it refetches on mount, polls and sees invalidations.
- **Pending and error UI belong to the route.** No screen has a suspense boundary of its own; trying again resets the failed queries and invalidates the router ([`useRetryRoute`](../../apps/web-app/src/app/use-retry-route.ts)).

**A first visit keeps the previous screen in view until the next screen has its data or 500 ms pass; only then does the route's `pendingComponent` show, for at least 300 ms** ([`createAppRouter`](../../apps/web-app/src/app/global-providers.tsx)). A loader that finds its data cached resolves well within that. The [navigation progress bar](../../apps/web-app/src/app/components/navigation-progress-bar.tsx) shows after 100 ms of a pending navigation from a shown screen; it follows the router's state, so links, the Android back button and swipe-back all show it. Links preload their route once they scroll into view (`defaultPreload: "viewport"`), so opening a track from Recents is usually instant, at the cost ADR 0016 accepts.

**A cold start or deep link shows the app's background until auth settles, then the route's `pendingComponent`, then its content.** The router shows no pending UI while a `beforeLoad` runs, so there is no router-wide pending component and no splash screen.

Code splitting puts a route's `component` into a separate chunk, while its `pendingComponent` and `errorComponent` stay in the eagerly loaded route module, so an error thrown during render, such as a refetch that drops shown data, shows the error screen at once instead of suspending on a chunk. Linaria styles in code the chunk and the route module share do not load, so shared styled pieces live in `src/app/components/`.

## Loading states

Every loading state a screen shows in place of its content carries `data-loading-state`: "Loading tracks…" on Recents, "Loading account…" while the account dialog loads the account snapshot, the detail view's loading skeleton, named "Loading track", and the page skeletons of home, the trial page and account recovery. The detail view shows the same skeleton shape as "Preparing track" for a conversion still being prepared, which is content the server sent and carries no marker. A cover fading in keeps its own `data-loading` and is not a loading state. The navigation progress bar carries `data-pending-signal` instead. Tests detect a loading flash with the [loading state recorder](../../qa/loading-state-recorder/README.md), which records every inserted element carrying `data-loading-state` or `data-pending-signal`, however briefly it stays; the [detection research](../research/playwright-loading-flash-detection.md) explains why it does not sample frames. The gallery runs the development build under Strict Mode, so one [E2E journey](../../qa/e2e/test-e2e/navigation.test.ts) checks the production build against the real Worker: it opens Recents and a track, goes Back and reopens the track while each refetch is held, and records no loading state after the cold start.

## Unknowns

- The Capacitor shells have no automated coverage of the loading model, because Playwright cannot drive iOS WKWebView and no test runs either shell. Back to Recents at its scroll position, reopening an audiobook and the first-visit progress bar are manual device checks in [CUP-44](https://linear.app/cup-audio/issue/CUP-44/test-the-android-and-ios-apps-native-functionality-on-physical-devices).
- The masonry's `ResizeObserver` spans have no automated WebKit coverage: Playwright runs Chromium only, and iOS Safari is checked by hand.
- Covers and the narration track are likely blocked in the Capacitor shells, because media routes send `Cross-Origin-Resource-Policy: same-origin` to pages on `capacitor://localhost` and `https://localhost`. This is inferred from the header and untested; shell playback is native-app work.
- That an Android native Google sign-in stores `user_metadata.name` was read from source, not observed on a device.
