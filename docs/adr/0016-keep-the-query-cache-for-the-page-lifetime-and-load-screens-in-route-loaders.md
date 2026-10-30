---
status: accepted
---

# Keep the query cache for the page lifetime and load screens in route loaders

Moving around the web app showed loading states the listener had no reason to see: going back from a detail view to Recents showed "Loading tracks…", reopening an audiobook showed its skeleton again, and a first visit dropped the previous screen into a skeleton at once. Both revisit symptoms came from the query client's `gcTime: 0`, which dropped a screen's data as soon as it unmounted, and only the trial route had a loader, so the router's preloading fetched nothing elsewhere ([patricktree/cup#144](https://github.com/patricktree/cup/issues/144)). The map [patricktree/cup#143](https://github.com/patricktree/cup/issues/143) (2026-10-29) decided one loading model for every screen, with three rules, in the browser and in the Capacitor shells alike:

1. **Revisit**: returning to a screen already shown during the page lifetime never shows a loading state.
2. **First visit**: the previous screen stays in view until the next one has its data or a short timeout passes; only then a skeleton.
3. **Cold start or deep link**: a skeleton is fine.

The decisions were taken in [patricktree/cup#146](https://github.com/patricktree/cup/issues/146) (cache lifetime), [patricktree/cup#147](https://github.com/patricktree/cup/issues/147) (where screens load), [patricktree/cup#148](https://github.com/patricktree/cup/issues/148) (first-visit pending), [patricktree/cup#149](https://github.com/patricktree/cup/issues/149) (no `<Activity>`), [patricktree/cup#152](https://github.com/patricktree/cup/issues/152) (Back to Recents), [patricktree/cup#154](https://github.com/patricktree/cup/issues/154) (no cache persistence) and [patricktree/cup#156](https://github.com/patricktree/cup/issues/156) (tests), on the research of [patricktree/cup#144](https://github.com/patricktree/cup/issues/144), [#145](https://github.com/patricktree/cup/issues/145), [#150](https://github.com/patricktree/cup/issues/150), [#151](https://github.com/patricktree/cup/issues/151), [#153](https://github.com/patricktree/cup/issues/153) and [#155](https://github.com/patricktree/cup/issues/155). The spec [patricktree/cup#157](https://github.com/patricktree/cup/issues/157) gathered them, and its tickets [patricktree/cup#158](https://github.com/patricktree/cup/issues/158) to [patricktree/cup#164](https://github.com/patricktree/cup/issues/164) implemented them in [patricktree/cup#165](https://github.com/patricktree/cup/pull/165). The [web application page](../architecture/web-app.md#query-cache) describes the result.

## Decision

- **The query cache lives for the page lifetime.** Every query keeps `gcTime: Infinity` and `staleTime: 0`, with no per-query override: a returning screen shows the cached content and requests it again in the background. Data leaves the cache only when the page reloads or the OS ends the app process, through `queryClient.clear()` on sign-out or an account switch, or through an explicit removal.
- **Every API write follows the cache rule.** A write lives in `src/data-fetching/`, owns its cache effects and invalidates by key prefix every query whose server data it may change. It edits the cache directly only where stale data would be false in a way the listener sees or acts on before the refetch returns, cancels that query's requests in flight first, and still invalidates afterwards. Query keys are grouped by owner so one prefix covers an account.
- **Routes load their screens' data, and components only observe it.** A route that shows server data or branches on auth settles auth in `beforeLoad`, with only the signed-in subject in the router context, and its loader awaits the critical query through `queryClient.query({ ...options, staleTime: 'static' })`, so cached data returns at once even when stale. The component reads the same query only through `useSuspenseQuery` or `useSuspenseInfiniteQuery`, which refetches on mount, polls and sees invalidations. Each route owns its `pendingComponent` and `errorComponent`.
- **The router holds the previous screen and preloads what is in view.** `createAppRouter` sets `defaultPendingMs: 500`, `defaultPendingMinMs: 300` and `defaultPreload: 'viewport'`, and a progress bar shows after 100 ms of a pending navigation.

### What `gcTime: 0` was protecting

[patricktree/cup#146](https://github.com/patricktree/cup/issues/146) audited what the old setting protected before dropping it. It dated back to the 1.0.0 release, and no page or ADR gave a reason for it.

- **No constraint**: a replaced account (the session clears the cache, and account keys carry the subject), polling (`refetchInterval` runs only while a screen is mounted), and cover URLs (stable within a UTC day since [ADR 0013](0013-cache-cover-images-in-the-browser-for-a-day.md)).
- **Real constraints, each settled by the cache rule or the player**: a deleted conversion is removed from the cached history before Recents shows again; a saved listening position is written into the cached audiobook; starting a trial conversion invalidates its grant; the player dates a narration track URL by the time its response arrived, not the time the screen showed it, keeping the 12-hour renewal of [ADR 0011](0011-serve-one-narration-track-and-play-it-with-one-audio-element.md) correct; a revisit refetch answered with _not found_ or _access denied_ drops the cached data and shows the error screen.
- **Not measured**: the memory that cached narration documents take, which is accepted.

### Awaiting in loaders, against TkDodo's advice

TkDodo's TanStack Router series advises against awaiting in loaders, so a slow request never blocks navigation, and prefers to start the fetch and let the component suspend ([patricktree/cup#150](https://github.com/patricktree/cup/issues/150)). Rule 2 needs the opposite: router state reaches React through `useSyncExternalStore`, so a transition does not hold a screen that suspends, and only an awaited loader lets the router keep the previous screen in view. The 500 ms `pendingMs` bounds the wait, after which the route's skeleton shows as the series would have it. Reading with `staleTime: 'static'` keeps a revisit's loader from waiting on the network, and suspense mode's one-second freshness floor after a loader avoids a second request on a first visit ([patricktree/cup#151](https://github.com/patricktree/cup/issues/151)).

### Viewport preloading

Touch has no hover, and `intent` preloads only on touchstart and never for Back. Preloading every link once it scrolls into view makes opening a track from Recents, the account dialog and Back to Recents after a deep link usually instant. The accepted cost is one audiobook request per Recents card that scrolls into view, once per page lifetime (a long narration document is about 80 KB uncompressed), one account snapshot and, after a deep link, one history page. The router's built-in `viewport` preloading uses one `IntersectionObserver` per link.

## Considered options

- **Keep screens mounted in React `<Activity>`** ([patricktree/cup#145](https://github.com/patricktree/cup/issues/145), [patricktree/cup#149](https://github.com/patricktree/cup/issues/149)). Rejected: screens scroll the window, so Activity would not keep the scroll position; hiding a screen unsubscribes its queries and re-runs its effects on return, so it needs the longer `gcTime` anyway; TanStack Router has no built-in support; and the memory of hidden screens is unmeasured.
- **Persist the query cache across app restarts** ([patricktree/cup#153](https://github.com/patricktree/cup/issues/153), [patricktree/cup#154](https://github.com/patricktree/cup/issues/154)). Rejected: auth in `beforeLoad` still needs the network on a cold start; audiobook keys carry no subject, so a restored cache risks showing the previous account's data; every deploy would empty it through its build buster; and it would leave narration text and signed media URLs unencrypted on the device. Rule 3 stands.
- **Component queries without loaders.** Rejected: nothing would hold the previous screen on a first visit, and preloading would fetch nothing.
- **A bounded `gcTime`, such as 12 hours for audiobooks.** Rejected in favour of dating track URLs by `dataUpdatedAt`: a bound would bring the revisit skeleton back after it expires.

## Consequences

- A screen's correctness after a revisit depends on its writes following the cache rule. A new API write that forgets to invalidate, or edits without cancelling, shows stale data until the next refetch.
- A revisited screen may show data changed on another device, such as an account lifecycle state, for one request's time.
- Memory grows with every audiobook opened or preloaded during the page lifetime.
- The Capacitor shells have no automated coverage of the loading model, because Playwright cannot drive iOS WKWebView; the [device checks of CUP-44](https://linear.app/cup-audio/issue/CUP-44/test-the-android-and-ios-apps-native-functionality-on-physical-devices) cover Back to Recents, reopening an audiobook and the first-visit pending behaviour by hand.
- Gallery component tests in [`_shell.recent.test.ts`](../../apps/web-app/src/routes/_shell.recent.test.ts) and [`_shell.audiobooks.$conversionId.test.ts`](../../apps/web-app/src/routes/_shell.audiobooks.$conversionId.test.ts) guard each rule with held responses and a recorder of every inserted loading state, and the [navigation E2E journey](../../qa/e2e/test-e2e/navigation.test.ts) guards the production build outside Strict Mode. Under `gcTime: 0` restored, the revisit tests fail.
