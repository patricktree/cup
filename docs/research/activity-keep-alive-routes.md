# Keeping route screens alive with React Activity

> Historical research, incorporated 2026-10-30. Cited by [ADR 0016](../adr/0016-keep-the-query-cache-for-the-page-lifetime-and-load-screens-in-route-loaders.md), which rejects `<Activity>`; built in [#165](https://github.com/patricktree/cup/pull/165); see [query cache](../architecture/web-app.md#query-cache). Cup uses none of the patterns below: a screen you leave unmounts and returns from the cache, and [Back to Recents](../architecture/web-app.md#routes-and-navigation) goes back in history for the scroll position, so the detail view's Back is no longer the push to `/recent` this page describes. Repository observations below describe `6a3f12c`.

[Original investigation](https://github.com/patricktree/cup/blob/baeb09a9f694142b42278a8d3db1f20f6774c010/docs/research/activity-keep-alive-routes.md).

Research date: 2026-10-29, for [issue #145](https://github.com/patricktree/cup/issues/145) of the [loading-flash map](https://github.com/patricktree/cup/issues/143). Repository observations are from `main` at `6a3f12c`. Versions are the ones the lockfile resolves: React and React DOM 19.3.0, `@tanstack/react-router` 1.170.42 with `@tanstack/router-core` 1.171.35, `@tanstack/react-query` and `@tanstack/query-core` 5.104.1. Experiments ran in Node 24.18.0 with happy-dom 20.14.6 against those installed packages, React's development build, without a browser, layout or a phone; the [experiment archive](activity-keep-alive-routes.tar.xz) holds the scripts and their logs. This page reports facts and patterns; whether Cup uses `<Activity>` belongs to the map's later tickets.

## Question

Can React `<Activity>` keep route screens alive under TanStack Router (for example Recents while the detail view is shown), through a built-in router feature or a pattern around `<Outlet>` / `useMatches`? For a screen hidden in `<Activity>`, what happens to its TanStack Query subscriptions (and its `gcTime` countdown), its `refetchInterval` polling, its effects, its DOM and scroll position, and the router's scroll restoration? What do these cost, and which known issues exist?

## Answer

- **TanStack Router has no built-in keep-alive or `<Activity>` support.** `<Outlet>` renders exactly one child match, and nothing in the router's docs or source mentions `<Activity>`. The feature request, [discussion #1447](https://github.com/TanStack/router/discussions/1447), has been open since 2024 with community workarounds only.
- **A layout can keep one child mounted by rendering the exported `<Match routeId>` inside `<Activity>`** next to a regular `<Outlet>` for the other children. In the experiment this kept Recents' state and DOM across Recents → detail → back, and Recents' own `<Outlet>` (the Add dialog) kept working. Rendering the route _component_ directly instead of `<Match>` breaks: its `<Outlet>` resolves against the parent's match and renders the parent's current child a second time, inside the hidden screen.
- **Hiding unsubscribes every TanStack Query observer in the screen.** `useBaseQuery` subscribes through `useSyncExternalStore`, whose subscription React holds in a passive effect, and a hidden `<Activity>` destroys effects. The query then has no observers, its polling timer stops, and its `gcTime` countdown starts as if the screen had unmounted. With Cup's `gcTime: 0` the query left the cache within one task of hiding, and revealing showed the loading state and fetched the first page again, dropping infinite-scroll pages. With a 5-minute `gcTime` the reveal showed the cached pages at once and refetched them in the background.
- **Polling stops while hidden, even with `refetchIntervalInBackground: true`.** That option only ignores window focus; the interval timer belongs to the observer, which is destroyed on unsubscribe. Polling resumes when the screen is revealed and resubscribes.
- **Effects, layout effects and ref callbacks are cleaned up on hide and run again on reveal**; state and DOM survive. React hides the DOM with `display: none !important`. Updates to external stores do not re-render a hidden screen, because it is unsubscribed; its own state updates and new props still render it, at low priority.
- **The router's scroll restoration does not depend on `<Activity>`**, but it benefits from it: it restores the document's scroll position by history entry after the destination renders, and a revealed screen has its full DOM in that commit. It restores only on back and forward navigation; a push to `/recent`, such as the detail view's Back link, scrolls to the top.
- **Known issues:** [TanStack/query#12227](https://github.com/TanStack/query/issues/12227) (open): if a query key changes while hidden, revealing fetches the old key once. [TanStack/query#11171](https://github.com/TanStack/query/issues/11171) (`useMutation` frozen at `pending` after hide and show) is fixed in the installed 5.104.1. Community keep-alive libraries for TanStack Router report stale `useSearch` values in kept routes.
- **Memory and render cost were not measured.** A hidden screen keeps its fibers, state and DOM nodes; it does no subscription-driven render work while hidden, and pays its effects' setup again on each reveal.

## Router: no built-in feature

- The router docs and source have no keep-alive option. A code search of `TanStack/router` for `keepAlive` and `React.Activity` finds nothing, and the only `<Activity` hit in `docs/` is an unrelated component name in an example (searched 2026-10-29).
- [Discussion #1447](https://github.com/TanStack/router/discussions/1447) ("Cache Routes to allow for Tabs to keep alive while offscreen", opened 2024-04-08) has no maintainer answer. Its workaround deep-clones the router context per kept outlet and hides inactive outlets with CSS. One reply links a library, [`tanstack-router-keepalive`](https://github.com/hemengke1997/tanstack-router-keepalive), and two later replies report that `useSearch` in a kept route stops following the URL.
- `<Outlet>` reads its own route id from `matchContext`, selects `ids[ids.indexOf(routeId) + 1]` from the router's ordered match ids, and renders a single `<Match routeId={childRouteId}>` ([`Match.tsx` L264–L330](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/react-router/src/Match.tsx#L264-L330)). Siblings such as Recents and the detail view are never rendered together.
- Match state is stored per route id, not per match: `getMatchStore(routeId)` returns one store per route ([`stores.ts` L120–L127](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/stores.ts#L120-L127)). A kept route therefore exists once; a kept detail view for one audiobook would show the next audiobook in the same instance.
- When a navigation removes a route, the router first publishes the new id list, then sets the leaving route's match store to `undefined` ([`stores.ts` L153–L167](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/stores.ts#L153-L167)). Route hooks such as `useMatch`, `useParams` and `useSearch` throw `Invariant failed: Could not find …` when they read a missing match ([`useMatch.tsx` L178–L192](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/react-router/src/useMatch.tsx#L178-L192)), and `<Match>` itself dereferences the match. A hidden route screen is therefore only safe while it does not render with its route inactive.

### Pattern: `<Match>` in `<Activity>` beside `<Outlet>`

The experiment's shell layout (`router.mjs` in the archive) does this:

```tsx
function KeepAliveOutlet() {
  const childRouteId = useRouterState({
    select: (state) =>
      state.matches[state.matches.findIndex((m) => m.routeId === "/_shell") + 1]?.routeId,
  });
  const [isRecentVisited, setIsRecentVisited] = React.useState(false);
  if (childRouteId === "/_shell/recent" && !isRecentVisited) setIsRecentVisited(true);
  const isRecentShown = childRouteId === "/_shell/recent";

  return (
    <>
      {isRecentVisited && (
        <Activity mode={isRecentShown ? "visible" : "hidden"}>
          <Match routeId="/_shell/recent" />
        </Activity>
      )}
      {!isRecentShown && <Outlet />}
    </>
  );
}
```

Observed on Recents → detail → history back → `/recent/add` (`results/router-match.txt`):

- Recents' state survived (a counter incremented before leaving was still set on return), and its DOM stayed in the document with `display: none` while the detail view rendered beside it.
- Recents' effect cleaned up on leaving and mounted again on return; its query polled only while shown.
- A state update made inside the hidden Recents did not render until the reveal, so the tombstoned match store was never read; with a route hook that reads Recents' own match added (`results/router-match-route-hook.txt`), no error appeared either. This rests on React deferring hidden work; no guarantee in React or the router was found, so treat the safety of route hooks in a hidden route as unverified.
- Recents' child route, the Add dialog, rendered through Recents' own `<Outlet>`.
- With `gcTime: 0`, the reveal rendered the query as `pending`, the loading state, before refetching.

The variant that renders `<RecentPage />` directly inside `<Activity>` (`results/router-component.txt`) rendered Recents twice on the first visit and, after navigating, the detail view twice: once in place and once inside the hidden Recents, through Recents' `<Outlet>`.

Not covered: route `loader`s, `pendingComponent`s, search params, route masks (Cup masks `/recent/add` as `/recent`), preloading, and the Capacitor shells.

## Query observers in a hidden screen

How the chain works, from the installed sources:

1. React registers a `useSyncExternalStore` subscription as a passive effect ([`ReactFiberHooks.js` L1721](https://github.com/facebook/react/blob/v19.3.0/packages/react-reconciler/src/ReactFiberHooks.js#L1721)). Hiding an `<Activity>` disconnects passive effects ([`ReactFiberCommitWork.js` L5236–L5300](https://github.com/facebook/react/blob/v19.3.0/packages/react-reconciler/src/ReactFiberCommitWork.js#L5236-L5300)), which unsubscribes.
2. `useBaseQuery` subscribes the observer inside that `useSyncExternalStore` call and syncs options in a later `useEffect` ([`useBaseQuery.ts` L91–L116](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/react-query/src/useBaseQuery.ts#L91-L116)).
3. When the observer loses its last listener, it destroys itself: it clears its stale timeout and refetch interval and removes itself from the query ([`queryObserver.ts` L124–L166](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/queryObserver.ts#L124-L166)).
4. A query without observers cancels retries (or the fetch, if its abort signal was consumed) and schedules garbage collection after `gcTime` ([`query.ts` L523–L548](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/query.ts#L523-L548), [`removable.ts` L23–L31](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/removable.ts#L23-L31)). It is removed only if it is idle and still has no observers ([`query.ts` L305–L309](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/query.ts#L305-L309)); a new observer cancels the countdown ([`query.ts` L511–L520](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/query.ts#L511-L520)).
5. On reveal, the subscription runs again; `onSubscribe` re-adds the observer to its query, fetches if `refetchOnMount` and staleness say so, and restarts the timers ([`queryObserver.ts` L110–L122](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/queryObserver.ts#L110-L122)).

The `refetchIntervalInBackground` check only skips the focus test inside the observer's own timer ([`queryObserver.ts` L517–L537](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/queryObserver.ts#L517-L537)), so it cannot keep a destroyed observer polling.

Suspense queries clamp `gcTime` and `staleTime` to at least 1 s ([`suspense.ts` L21–L46](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/react-query/src/suspense.ts#L21-L46)), so Cup's `gcTime: 0` becomes 1 s for `useSuspenseQuery`.

Measured (`query.mjs`; polling every 100 ms, as Cup's queries poll while an item is pending):

| Case                                                | While hidden                             | On reveal                                                                                    |
| --------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `useInfiniteQuery`, `gcTime: 0`, 3 pages loaded     | 0 fetches; query removed from the cache  | Renders `status: pending` (the loading state), fetches page 1 again; 2 loaded pages are lost |
| `useInfiniteQuery`, `gcTime` 5 min, 3 pages loaded  | 0 fetches; query cached with 0 observers | Renders the 3 cached pages at once, refetches all 3 in the background, resumes polling       |
| `useSuspenseQuery`, `gcTime: 0` (1 s), hidden 0.5 s | 0 fetches; query cached                  | Renders cached data at once, resumes polling                                                 |
| `useSuspenseQuery`, `gcTime: 0` (1 s), hidden 1.5 s | 0 fetches; query removed after 1 s       | Suspends: the Suspense fallback shows until the refetch resolves, then effects mount         |

For Cup specifically: the detail view also observes the account history key, through `useIsAccountConversion` without polling ([`account-history.ts`](https://github.com/patricktree/cup/blob/6a3f12c/apps/web-app/src/data-fetching/account-history.ts#L36-L55)), once its audiobook has loaded. While that observer exists, the history query has an observer even with Recents hidden, so it is not collected; this interplay was not tested.

## Effects, DOM and Cup's hooks

The React docs state that hiding "will also destroy their Effects, cleaning up any active subscriptions", keeps state, hides children with `display: none`, and still re-renders hidden children on new props, at a lower priority than visible content ([Activity reference](https://react.dev/reference/react/Activity), read 2026-10-29). In the source, hiding sets `display: none !important` on the nearest host nodes ([`ReactFiberConfigDOM.js` L1406–L1416](https://github.com/facebook/react/blob/v19.3.0/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js#L1406-L1416)), and the disappear pass detaches refs and runs layout cleanups ([`ReactFiberCommitWork.js` L3277](https://github.com/facebook/react/blob/v19.3.0/packages/react-reconciler/src/ReactFiberCommitWork.js#L3277)).

Observed order (`refs.mjs`): on hide, layout effect cleanup, ref callback cleanup, store unsubscribe, passive effect cleanup, then one low-priority render of the hidden tree. An external store update while hidden rendered nothing; a state update inside the hidden tree rendered it and updated the hidden DOM. On reveal: render, ref callback attach, layout effect, store subscribe, passive effect. The docs add that `<StrictMode>` (on in Cup's [`bootstrap.tsx`](https://github.com/patricktree/cup/blob/6a3f12c/apps/web-app/src/bootstrap.tsx#L57)) runs extra Activity unmounts and mounts in development.

What that means for the hooks the ticket names, from reading Cup's code:

- **`useIsInScrollReach`** ([source](https://github.com/patricktree/cup/blob/6a3f12c/apps/web-app/src/app/use-is-in-scroll-reach.ts)) uses a ref callback with a cleanup, so hiding disconnects its `IntersectionObserver` and sets "in reach" to `false`; revealing creates a new observer, whose first entry restarts Recents' next-page effect. `useMasonryRowSpans` disconnects and reconnects its observers the same way; its row spans stay in the hidden DOM.
- **Status announcer**: the provider and its live region sit in `_shell`, outside any kept screen, and are unaffected. A hidden screen runs no effects, so it cannot announce until revealed.
- **Player host**: `PlayerHostProvider` sits in `_shell` and keeps running. The detail view's `useShownConversion` is a layout effect, so hiding a kept detail view would call `hideConversion` and revealing would call `showConversion`. Player state hooks use `useSyncExternalStore` and re-read their snapshot on reveal. The narration `<audio>` element belongs to the player host, not to a route's DOM, so the docs' warning about media in hidden trees does not apply to route screens.
- **Recents' `<Navigate>`** for signed-out listeners navigates from a layout effect ([`useNavigate.tsx` L73](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/react-router/src/useNavigate.tsx#L73)), so it cannot fire while Recents is hidden.
- Recents' sticky footer (mini player and tab bar) is inside the Recents route and hides with it.

## Scroll position and scroll restoration

- `<Activity>` preserves a screen's DOM, not the document's scroll offset: Cup scrolls the document, which has a single position shared by whichever screen is visible.
- With `scrollRestoration: true`, the router snapshots the document's scroll position before each navigation, keyed by the history entry's `__TSR_key` ([`scroll-restoration.ts` L49–L51, L201–L206](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/scroll-restoration.ts#L201-L206)). After the destination's matches commit, an `onRendered` handler calls `window.scrollTo` once with the saved position, or scrolls to the top when the entry has none ([L250–L373](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/scroll-restoration.ts#L250-L373)).
- A revealed screen's DOM, including every infinite-scroll page and the masonry spans, is back in that commit, so the saved offset fits; a remounted screen showing "Loading tracks…" or only its first page is shorter, and the browser clamps the offset. With `gcTime: 0` a revealed Recents still shows the loading state (see above), so `<Activity>` alone does not help restoration there. Scroll behavior was read from source, not measured in a browser.
- Only back and forward navigation finds a saved entry. The detail view's Back control is a `<Link to="/recent">` ([`detail-top-bar.tsx`](https://github.com/patricktree/cup/blob/6a3f12c/apps/web-app/src/app/components/detail-top-bar.tsx#L50-L60)), a push with a new key, so it scrolls to the top with or without `<Activity>`; the Android back button and browser back restore. The router's `getScrollRestorationKey` option changes the key, for example to the pathname.

## Cost

- Memory: a hidden screen keeps its React fibers, hooks state, query observer objects and DOM nodes (for Recents, every loaded card and its cover `<img>`). The React docs suggest hiding content the user will likely return to soon. No measurement was taken; how browsers treat decoded images under `display: none` is unknown here.
- Render work while hidden: none from external stores (they are unsubscribed); low-priority renders for the screen's own state updates and for new props or context. `<Match>` is memoized on `routeId`, so a parent re-render does not reach the kept screen.
- Work on reveal: one render of the screen, all its effects and ref callbacks set up again, observers resubscribed, and the queries' mount refetches (an infinite query refetches every loaded page).

## Limits

- The experiments ran in happy-dom with React's development build, without layout or painting, so nothing here measures scroll offsets, frames or memory; the router experiment uses a small stand-in route tree, not Cup's.
- The safety of route hooks in a hidden route (the tombstoned match store) is observed in one setup, not guaranteed by either library.
- WebKit, Android WebView and the Capacitor shells were not tested.

## Reproduction

Unpack [`activity-keep-alive-routes.tar.xz`](activity-keep-alive-routes.tar.xz) anywhere, install Cup's dependencies in a checkout, and run `sh run-all.sh` with `CUP_PNPM` set to that checkout's `node_modules/.pnpm` directory. The scripts import the pinned packages from there by absolute path; the router runs need `--conditions=browser`, which `run-all.sh` passes, because the default Node condition selects the router's server build. Logs land in `results/`; the archive includes the logs this page cites.
