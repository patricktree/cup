# Web application screens

The shared web application, which the Capacitor shells also render, gives signed-in listeners Recents, with the Add and account dialogs over it, gives a listener whose account deletion is scheduled an account recovery page, and gives every audiobook a detail view. User-facing copy calls an audiobook a track ([glossary](../GLOSSARY.md#audiobook)). This page holds what spans the screens; each screen's own behaviour is in its route, its tests and its stories, and [playback](conversion.md#playback) covers the one player behind every screen.

## Routes and navigation

- **Home and Recents.** A signed-in listener on `/` is redirected to Recents (`/recent`), and a signed-out listener on `/recent` or one of its dialogs back to `/`. Two cases keep a signed-in listener off that redirect: a start submitted on the home page that is still pending, resumed after OAuth or waiting out a rate limit, finishes there ([resuming after sign-in](authentication.md#resuming-a-conversion-after-sign-in)), and a URL shared while signed in goes to the Add dialog instead.
- **Add dialog.** Adding a track is the child route `/recent/add`, rendered over Recents and [masked](../../apps/web-app/src/app/global-providers.tsx) so the URL bar keeps `/recent`. Its start request lives only while the dialog is open, apart from the home page's stored request, so a dialog start never resumes on the home page.
- **Account dialog.** The avatar on Recents opens the account settings as the child route `/recent/account`, rendered over Recents like the Add dialog but not masked: confirming a deletion or recovery signs in with Google again, and that sign-in returns to the path in the URL bar, where the dialog has to reopen with the confirmation step.
- **Account recovery.** `/account-recovery` restores an account whose deletion is scheduled, and the scheduled-deletion email links it. Scheduling deletion signs the listener out, so unlike the account dialog, this page offers sign-in itself, and it shows no account chrome. Its Google confirmation returns to it the same way. For an active account it only links to Recents.
- **Detail view.** `/audiobooks/{conversionId}` serves account and trial audiobooks with one view. Its back target is Recents when an account is signed in and `/` otherwise; trial pages show no account chrome. For a track the account history lists, its menu deletes the track after a confirmation, unloading it from the player first and replacing the detail entry with Recents ([conversion deletion](conversion-deletion.md)); a trial track a signed-in listener can open offers no deletion.

The [routing E2E tests](../../qa/e2e/test-e2e/routing.test.ts) and the [Recents route tests](../../apps/web-app/src/routes/_shell.recent.test.ts) pin these paths, including closing the dialogs and signed-in share intake.

## Recents covers and order

Recents is one newest-first list on a CSS grid with 1 px rows; [`useMasonryRowSpans`](../../apps/web-app/src/app/use-masonry-row-spans.ts) gives each card a row span from its measured height, so reading, focus and screen-reader order follow the visual order and an appended page moves no existing card. Any card whose height changes re-places the cards after it, which is why covers are cropped to a fixed 5:3 with no stored dimensions. The [masonry research](../research/recents-masonry-layout.md) explains why neither CSS `grid-lanes` nor multi-column fits yet.

A ready history item carries its cover's own [signed media URL](authentication.md#signed-media-url), identical for a UTC day and cached by the browser for a day ([ADR 0013](../adr/0013-cache-cover-images-in-the-browser-for-a-day.md)), so polls and app starts download no cover again.

## Account holder's name

The avatar's initials come from the Supabase session's `user_metadata.name`, else `full_name`, which Supabase fills from the Google sign-in and refreshes on each sign-in. Cup stores no name, so account erasure has none to remove.

## Query cache

Every screen reads server data through the TanStack Query cache, whose keys the [key factories](../../apps/web-app/src/data-fetching/query-keys.ts) group by owner: everything of the signed-in account sits under `["account", subject]`, next to each audiobook and each grant.

**Returning to a screen shown earlier never shows a loading state.** The [query client](../../apps/web-app/src/data-fetching/query-client.ts) keeps every query for the page lifetime, until the page reloads or the OS ends the app process (`gcTime: Infinity`), and treats it as stale at once (`staleTime: 0`), with no per-query override. A returning screen shows the cached content and requests it again in the background. Data leaves the cache only through `queryClient.clear()` on sign-out or an account switch ([`account-session.ts`](../../apps/web-app/src/auth/account-session.ts)) or an explicit removal, such as a deleted conversion's audiobook. The memory that cached narration documents take is accepted unmeasured. No screen stays mounted while hidden: a screen the listener leaves unmounts, Recents renders every cached history page in its first commit on return, and polling runs only while its screen is shown, so leaving a screen stops its `refetchInterval` and returning requests the data once and polls again. Failed queries are not retried, and the cache does not refetch when the window regains focus or the connection returns.

The cache must never show the listener something false, including on a screen they return to, so every API write follows one rule:

- **The write owns its cache effects.** It lives in `src/data-fetching/` and, once it succeeds, invalidates by key prefix every query whose server data it may change.
- **A direct edit only where stale data would mislead.** A write edits the cache itself only when the listener would see or act on stale data before the refetch returns. It cancels that query's requests in flight first, so an earlier response cannot undo the edit, and still invalidates afterwards.

The direct edits:

- **Deleting a conversion** removes it from the cached history pages before leaving its detail view, so Recents never shows the deleted card, then drops its audiobook and invalidates the account.
- **Saving a signed-in listener's listening position** writes it into the cached audiobook, so an audiobook opened again loads at that position. The invalidation after the save requests nothing at once, because playback saves every few seconds; the next screen to show the audiobook requests it.
- **Exchanging a trial link's credential** caches the grant it answers with.

Starting an account or trial conversion and confirming an account deletion or recovery only invalidate. A cached audiobook keeps the time its response arrived, which dates its narration track URL for [renewal](authentication.md#signed-media-url), so a direct edit preserves it. A refetch of shown data answered with _not found_ or _access denied_ drops the cached data, so the screen shows its error screen ([`query-client.ts`](../../apps/web-app/src/data-fetching/query-client.ts)); other failures keep the content and report a toast. The [detail view tests](../../apps/web-app/src/routes/_shell.audiobooks.$conversionId.test.ts) check what a revisit shows after each direct edit, and the [Recents tests](../../apps/web-app/src/routes/_shell.recent.test.ts) check revisits of Recents, a track and both dialogs; each holds the revisit's refetch until the cached content is checked. A suspense query stays cached for at least one second without an observer whatever its `gcTime`, so these tests advance a [Playwright clock](https://playwright.dev/docs/clock) past that before the revisit.

## Where screens load

Every route whose screen shows server data or branches on auth starts loading in the route, so the router can keep the previous screen in view while it waits and owns the screen's pending and error UI:

- **Auth settles in `beforeLoad`.** A route that needs the account awaits [`settleAccountSession`](../../apps/web-app/src/auth/account-session.ts), which waits for account auth to initialize, and redirects a signed-out listener with `replace`; an auth failure reaches the route's `errorComponent`. Recents' `beforeLoad` puts only the signed-in `subject` into the router context, for its loader and the dialogs under it. Query options are built in each loader and component from the subject, so none outlives an account switch. Home's `beforeLoad` redirects a signed-in listener to Recents before the start form ever renders, and account recovery's settles auth before choosing between sign-in and the account. A component keeps a `<Navigate>` only for a sign-out while its screen is shown.
- **The loader awaits the critical query and returns nothing.** It reads with `queryClient.query({ ...options, staleTime: 'static' })`, or `queryClient.infiniteQuery` for the history, so cached data returns at once even when stale: Recents awaits the first history page, the account dialog and account recovery the account snapshot, the detail view the audiobook, and the trial page its grant. The detail view needs no `beforeLoad`, because its audiobook request waits for any session itself.
- **The component observes the same query through a suspense hook.** It reads only through `useSuspenseQuery` or `useSuspenseInfiniteQuery`, never `Route.useLoaderData`, so it refetches stale data on mount, polls and sees invalidations.
- **Pending and error UI belong to the route.** Each data route declares a `pendingComponent` and an `errorComponent`; no screen has a suspense boundary of its own. Trying again from an error screen resets the failed queries and invalidates the router, which reruns `beforeLoad` and the loader ([`useRetryRoute`](../../apps/web-app/src/app/use-retry-route.ts)). The router shows a route's `pendingComponent` only once its loader has waited 500 ms, and then for at least 300 ms, so a loader that finds its data cached never shows it.

**A cold start or deep link shows the app's background until auth settles, then the route's `pendingComponent`, then its content.** The router shows no pending UI while a `beforeLoad` runs, so there is no router-wide `defaultPendingComponent`, no placeholder in `index.html` and no splash screen. The [Recents route tests](../../apps/web-app/src/routes/_shell.recent.test.ts) check that a signed-in cold start on `/` never renders the start form and that a signed-out listener on Recents or a dialog is sent home in place of that history entry.

The router's code splitting puts a route's `component`, `pendingComponent` and `errorComponent` into separate chunks, and Linaria styles in code the three share do not load. Shared styled pieces, such as Recents' layout or the detail view's skeleton, live in `src/app/components/`.

## Loading states

Every loading state a screen shows in place of its content carries `data-loading-state`: "Loading tracks…" on Recents, "Loading account…" while the account snapshot loads, the detail view's loading skeleton, named "Loading track", and the page skeletons of home and the trial page. The detail view shows the same skeleton shape as "Preparing track" for a conversion still being prepared, which is content the server sent and carries no marker. A cover fading in keeps its own `data-loading` and is not a loading state. Tests detect a loading flash with [`recordLoadingStates`](../../apps/web-app/src/test-utils/loading-state-recorder.ts), which records every inserted element carrying `data-loading-state` or `data-pending-signal`, however briefly it stays; the gallery component tests import it through `#src/test-utils/` and `qa/e2e` through `@cup/web-app/test-utils/loading-state-recorder`.

## Unknowns

- The masonry's `ResizeObserver` spans have no automated WebKit coverage: Playwright runs Chromium only, and iOS Safari is checked by hand.
- Covers and the narration track are likely blocked in the Capacitor shells, because media routes send `Cross-Origin-Resource-Policy: same-origin` to pages on `capacitor://localhost` and `https://localhost`. This is inferred from the header and untested; shell playback is native-app work.
- That an Android native Google sign-in stores `user_metadata.name` was read from source, not observed on a device.
