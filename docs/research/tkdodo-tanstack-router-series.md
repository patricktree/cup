# TkDodo's TanStack Router series on loading data during navigation

> Historical research, incorporated 2026-10-30. Cited as rationale by [ADR 0016](../adr/0016-keep-the-query-cache-for-the-page-lifetime-and-load-screens-in-route-loaders.md), built in [#165](https://github.com/patricktree/cup/pull/165); see [where screens load](../architecture/web-app.md#where-screens-load). Cup differs from the series: its loaders await, as this page concludes rule 2 needs; each route owns its `pendingComponent`, with no router-wide `defaultPendingComponent`; no route uses the `context` function, since query options built in the loader and the component never keep an old subject after an account switch; and links preload on `viewport`, not `intent`. Repository observations below describe `0a333e6`.

[Original investigation](https://github.com/patricktree/cup/blob/0f9c95ef2fde9c846760d72c4955c8953f2574a7/docs/research/tkdodo-tanstack-router-series.md).

Research date: 2026-10-29, for [issue #150](https://github.com/patricktree/cup/issues/150) of the [map: navigate the web app without loading flashes](https://github.com/patricktree/cup/issues/143). The sources are the four posts of Dominik Dorfmeister's (TkDodo, TanStack Query maintainer and TanStack Router contributor) TanStack Router series, read in full on the research date, both as published and as MDX in [TkDodo/blog at `9c64b98`](https://github.com/TkDodo/blog/tree/9c64b980586a4c2e8fd7b9ac87d39332d3d8c5ea/content/posts). Library claims were checked against the installed sources: `@tanstack/react-router` 1.170.42 with `@tanstack/router-core` 1.171.35 (linked at TanStack/router commit [`c79c620`](https://github.com/TanStack/router/tree/c79c620bf479cf53d64fb301407c2206922c0b4a), which the [sibling page](router-query-loading-interplay.md) for [issue #144](https://github.com/patricktree/cup/issues/144) matched byte for byte against `node_modules`), `@tanstack/react-store` 0.11.2, `react-dom` 19.3.0, and `@tanstack/react-query` / `@tanstack/query-core` 5.104.1 (TanStack/query commit [`29859ae`](https://github.com/TanStack/query/tree/29859ae60c8dca0a5cdbf8abccc775b655cf43e2)). Repository observations are from `main` at [`0a333e6`](https://github.com/patricktree/cup/tree/0a333e6). Nothing was run in a browser or on a phone. This page reports what the posts recommend and where that holds for Cup; the map's tickets decide.

## Question

What do the four posts recommend for how a screen loads its data during navigation: route loaders versus component queries, awaiting versus starting fetches in loaders, `beforeLoad` and router context (for example a signed-in subject), pending components and `pendingMs` / `pendingMinMs`, preloading, and the router's cache next to TanStack Query? Where does a recommendation conflict with the installed versions or with the findings for issue #144?

## Answer

- **Start fetches in the loader, read them with a query hook in the component.** The series treats the loader as an event handler that only primes the Query cache and returns nothing; the component reads the same query with `useSuspenseQuery` (or `useQuery`). It advises against `useLoaderData` for Query data, because a query without an observer gets no refetches, no refetch on invalidation, and can be garbage-collected while on screen. This matches ticket #147's decision and the sibling page.
- **The series prefers never awaiting in the loader; for Cup's rules that is not equivalent to awaiting.** Post 3 says a non-awaited loader plus `useSuspenseQuery` behaves as if the loader had awaited. In 1.170 it does not: an awaited loader keeps the previous screen and lets `pendingMs` / `pendingMinMs` decide when a pending component shows, while a non-awaited loader commits at once, and the suspending component shows the nearest Suspense fallback immediately. Rule 2 of the map (hold the previous screen until data or a short timeout) needs the awaited form #147 chose.
- **React transitions do not hold the previous screen for the router.** Post 1 notes that the router keeps its state outside React and subscribes with `useSyncExternalStore`, which opts out of concurrent features. The installed code confirms it, and React documents that store updates cannot be transitions and trigger the nearest Suspense fallback. This conflicts with the sibling page's claim that a suspending component under an already-revealed boundary is held by the router's transition.
- **Which cache method the loader calls hardly matters to the series, and the method it waited for has shipped.** The posts use `ensureQueryData` (awaited) and `prefetchQuery` (not awaited) and point to the RFC for a single `queryClient.query`. In Query 5.104 that method exists and the old ones are deprecated: `query({ ...options, staleTime: 'static' })` replaces `ensureQueryData`.
- **Keep loader and component on the same query options by putting them into route context.** Post 4 shows loaders drifting from components (a search param added to the component's query key but not the loader's) and causing a second fetch and a second suspend. Its fix is `loaderDeps` for search params plus the route `context` function, which builds the `queryOptions` once; the loader and the component both read them from context. The `context` option exists in the installed router, is synchronous, and runs only when a match is new.
- **Let Query own caching: `defaultPreloadStaleTime: 0`.** Post 3 turns off the router's own caching by setting this one option (the router's `staleTime` already defaults to 0). Cup already sets it.
- **Router context carries the `QueryClient`; `beforeLoad` adds to it.** Values a parent's `beforeLoad` returns are inherited, typed, by every child's `beforeLoad`, `context`, loader and `useRouteContext`. The series never covers auth that is still restoring; the installed code makes an awaited parent `beforeLoad` the place to wait for a signed-in subject, since `beforeLoad` runs serially and is awaited, whereas loaders run in parallel and `context` cannot be async.
- **Pending UI and preloading get little detail.** Post 3 recommends a router-wide `defaultPendingComponent` and `defaultErrorComponent`, and says intent preloading gives prefetch-on-hover for free. The series does not discuss `pendingMs` / `pendingMinMs` or touch devices; the sibling page covers both from source.

## The four posts

### #1: The Beauty of TanStack Router (2025-05-25)

[Post](https://tkdodo.eu/blog/the-beauty-of-tan-stack-router). An overview of why he chose the router: type-safe params and links, validated and typed search params, selectors for fine-grained subscriptions, file-based routing with automatic code splitting, and Suspense support. On data, it shows a loader that calls `prefetchQuery` without awaiting and a component that reads the query with `useSuspenseQuery`, and states that every route is wrapped in a Suspense and an error boundary by default. A side note says navigations are wrapped in `startTransition`, but since router state lives outside React behind `useSyncExternalStore`, transitions are poorly supported until React ships concurrent stores.

### #2: Context Inheritance in TanStack Router (2025-10-12)

[Post](https://tkdodo.eu/blog/context-inheritance-in-tan-stack-router). Parsed path params, validated search params and route context accumulate from parent to child routes, both at runtime and in the types. Router context, created with `createRootRouteWithContext` and filled in `createRouter`, injects the `QueryClient` into loaders; the example loader awaits `ensureQueryData` and the component reads the query with `useSuspenseQuery`. `beforeLoad` can return values that become part of the context for that route and all its children, readable with `useRouteContext`. At the time, `beforeLoad` was the only function that could add to the context.

### #3: TanStack Router and Query (2026-05-26)

[Post](https://tkdodo.eu/blog/tan-stack-router-and-query). The router's own cache stores loader data per route, which suits route-specific data; Query's cache is global by query key, which suits data several routes share. Recommendations:

- Initiate fetches in loaders: they run before the component renders, possibly before its code chunk loads, and intent preloading runs them before the click.
- Put the `QueryClient` into router context, and use the same instance for the `QueryClientProvider`.
- Turn off router caching so that only one layer decides freshness: set `defaultPreloadStaleTime: 0`.
- Prefer `useSuspenseQuery`, because it uses the route's Suspense and error boundaries; set `defaultPendingComponent` and `defaultErrorComponent` once on the router.
- Never await in the loader and let the component decide: `useSuspenseQuery` for blocking data, `useQuery` for deferred data, which also avoids waterfalls between several suspending queries.
- Always read Query data through a query hook, not `useLoaderData`, so that the query has an observer.
- "Treat the loader as an event handler": it starts fetching after a navigation or a sign of intent, returns no data, and pages must still work without it.

It also explains that the choice among `prefetchQuery`, `ensureQueryData` and awaiting barely matters, and points to [the RFC](https://github.com/TanStack/query/discussions/9135) that unifies them into `queryClient.query`. The SSR section (TanStack Start) does not apply to Cup's client-rendered app.

### #4: Reliable Query Prefetching with TanStack Router (2026-08-18)

[Post](https://tkdodo.eu/blog/reliable-query-prefetching-with-tanstack-router). Components should, where possible, not start fetches themselves, because that is late and invites waterfalls. The cost of loaders is duplication: the loader and the component must request exactly the same queries, and nothing warns when they drift. His example adds an `asOf` search param to the component's query key only; a shared link then fetches today's data in the loader, renders, fetches again with `asOf`, and suspends a second time. The fixes:

- Declare the search params a loader depends on with `loaderDeps`, since loaders do not receive search params directly.
- Build the `queryOptions` in the route's `context` function from `params` and `deps`, then read them in the loader (`context.dashboardQueryOptions`) and in components (`useRouteContext()`). The `context` function runs only when the loader would run (params or deps changed), unlike `beforeLoad`, which runs on every navigation and sees the full search.
- Because context inherits, a root route can define the user's `queryOptions` and prefetch them in its loader, and every child can read them.
- Reading context does not cause extra renders: the `queryOptions` object changes only when `context` reruns.

## Findings on the map's open questions

### How loaders read the cache

The posts use `ensureQueryData` (posts 2–4, awaited) and `prefetchQuery` (posts 1 and 3, not awaited). In 5.104 both are deprecated: `ensureQueryData` in favour of `queryClient.query({ ...options, staleTime: 'static' })`, `prefetchQuery` in favour of `queryClient.query(options)` with `.catch(noop)` to swallow errors ([`queryClient.ts` L196, L607, L641](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/queryClient.ts#L195-L224)). The RFC post 3 links is therefore settled, and the sibling page's table of the methods' behaviour applies. A non-awaited `query(...)` rejects on failure, unlike `prefetchQuery`, so a fire-and-forget loader must catch.

### Double fetching between loader and component

The series names two sources and fixes one of them:

- **Mismatched options** (post 4): different query keys in the loader and component cause a second fetch and a second suspend. Sharing `queryOptions` through route context removes that risk. In the installed router, the `context` route option exists, its result is cached on the match (`match._ctx ||= route.options.context(...)`), and it is called synchronously, not awaited ([`load-client.ts` L413-L423](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/load-client.ts#L413-L423)). A match's identity comes from its path and `loaderDeps`, and a cached or retained match is copied with its `_ctx` ([`router.ts` L1682-L1727](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/router.ts#L1682-L1727)). The option is typed in [`route.ts`](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/route.ts#L999) but, as post 4 says, not described in the guides.
- **Loader and mount racing** (post 3): the component either finds data or joins the in-flight request, so there is one request. That holds in 5.104: a fetch on a query that is already fetching returns the existing promise ([`query.ts` L593-L607](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/query-core/src/query.ts#L593-L607)).

Not covered by the series: a stale entry refetches when its observer mounts. Suspense raises `staleTime` to at least 1,000 ms ([`suspense.ts` L21-L47](https://github.com/TanStack/query/blob/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/packages/react-query/src/suspense.ts#L21-L47)), so data an awaited loader just fetched is not refetched on mount. Data preloaded on `touchstart` and returned by a `staleTime: 'static'` loader more than a second later would be refetched in the background with Cup's `staleTime: 0` (derived from source, not observed).

### `beforeLoad`, router context and a signed-in subject

The series covers context only as dependency injection and as a carrier of `queryOptions`; it never discusses auth that is still restoring or a query key that needs the signed-in subject. From the installed code:

- `beforeLoad` runs for each route in order, parent first, and its result is awaited and merged into that match's context before the next route's `context` function and `beforeLoad` run ([`load-client.ts` L393-L480](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/load-client.ts#L393-L480)). Loaders then run in parallel ([`settleTasks`](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/load-client.ts#L1035-L1081)). So a child loader can rely on a subject that a parent's `beforeLoad` awaited and returned, but not on a parent loader's result. Post 4's root-loader example for user data therefore fits data that only components read, not data a child loader keys on.
- `beforeLoad` also runs on preloads (with `preload: true`). Cup's root `beforeLoad` returns early for preloads and starts `ensureAuthInitialized()` without awaiting it ([`__root.tsx`](https://github.com/patricktree/cup/blob/0a333e6/apps/web-app/src/routes/__root.tsx#L12-L23)); a route whose preload needs the subject has to await auth itself.
- Because the `context` function cannot await and its result is reused for as long as the match is kept, `queryOptions` built there from a subject would keep the old subject if the account changes while the route's path stays the same; `router.invalidate()` keeps the cached `_ctx`, while `router.clearCache()` drops cached matches ([`router.ts` L2493-L2635](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/router.ts#L2493-L2635)). This is derived from source and not reproduced.

### Pending components, `pendingMs` and `pendingMinMs`

Post 3 says the router shows the pending component while an awaited loader is pending. In 1.170 it shows only after `pendingMs` (library default 1,000 ms) and then for at least `pendingMinMs` (default 500 ms), and only when the route or router defines a pending component ([`offerPending`](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/load-client.ts#L1486-L1510), [`router.ts` L1220-L1222](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/router.ts#L1220-L1222)). The series does not discuss either timing.

Posts 1 and 3 say every route is wrapped in its own Suspense and error boundary by default. In 1.170 a non-root route gets its own `<Suspense>` only when it has a pending component (its own or `defaultPendingComponent`) or `wrapInSuspense`, and an error boundary only when it has an error component ([`Match.tsx` L96-L157](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/react-router/src/Match.tsx#L96-L157)). Post 3's recommended `defaultPendingComponent` restores the statement. Cup sets `defaultErrorComponent` but no pending component ([`global-providers.tsx`](https://github.com/patricktree/cup/blob/0a333e6/apps/web-app/src/app/global-providers.tsx#L19-L35)), so its routes have error boundaries and no route-level Suspense.

Awaiting versus not awaiting decides which timer applies:

| Loader                                   | What the listener sees on a first visit, in 1.170                                                                                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Awaits the query                         | Previous screen until the data arrives; with a pending component, it shows after `pendingMs` for at least `pendingMinMs`                                                                                                                                                            |
| Starts the query without awaiting (#3's) | The router commits at once; the component suspends and the nearest Suspense boundary shows its fallback immediately: the route's pending component if one is set, otherwise the root boundary's (`defaultPendingComponent` or nothing). `pendingMs` and `pendingMinMs` do not apply |

The second row follows from the transition finding below and from `offerPending` acting only while the router is loading; it is derived from source, not observed.

### Transitions and the previous screen

Post 1's caveat holds in the installed versions. The router wraps the commit in `React.startTransition` ([`Transitioner.tsx` L31-L37](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/react-router/src/Transitioner.tsx#L31-L37)), but `Matches`, `Match` and the router hooks read router state through `useSelector` from `@tanstack/react-store` 0.11.2, which calls `useSyncExternalStoreWithSelector` (`src/useSelector.ts`). React schedules a store-change re-render on the synchronous lane (`forceStoreRerender` in `react-dom-client.development.js` 19.3.0), and the React docs say store mutations cannot be marked as non-blocking transitions and so trigger the nearest Suspense fallback ([`useSyncExternalStore` caveats](https://react.dev/reference/react/useSyncExternalStore#caveats)). This is derived from source and the React docs; it was not observed in a browser.

### Preloading and touch devices

Post 3 credits `intent` preloading with prefetch-on-hover for free (it names the option `prefetch: 'intent'`; the router's option is `preload` / `defaultPreload`). The series says nothing about touch. The sibling page's source reading applies: `intent` fires on `touchstart` without delay, and history traversal never preloads. Post 4's `context` function also runs on preloads, so a preload and the following navigation build the same `queryOptions` from the same params and deps.

### The router's cache next to Query

The series' advice is to let Query own caching. Router defaults in 1.170 match post 3: `staleTime` defaults to 0 and `preloadStaleTime` to 30 s ([`load-client.ts` L806-L815](https://github.com/TanStack/router/blob/c79c620bf479cf53d64fb301407c2206922c0b4a/packages/router-core/src/load-client.ts#L806-L815)). Router `gcTime` defaults to 5 minutes, not 0, but with a loader that returns nothing, the router's cache holds only a match, not data. With `defaultPreloadStaleTime: 0` every preload and navigation calls the loader, and the `staleTime` passed to the Query method decides whether it fetches. The series does not discuss Query's `gcTime`; the sibling page shows that Cup's `gcTime: 0` defeats any loader or preload.

## Agreement and conflict with the sibling research (#144)

Agreements:

- Loader starts and Query caches; components keep an observer through a query hook (the sibling cites TkDodo's older React Router post for this; the series repeats it for TanStack Router).
- `defaultPreloadStaleTime: 0` with an external cache.
- `queryClient.query` replaces the deprecated imperative methods.
- A blocking loader with a pending component and `pendingMs` / `pendingMinMs` is the router-owned way to hold the previous screen with a timeout.

Conflicts:

- **Transition hold.** The sibling page says a component suspending under an already-revealed boundary is held by the router's transition with no time limit (its combinations table, third row, and its second mechanism for rule 2). Post 1 says the router's `useSyncExternalStore` bails out of concurrent features, and the installed code and React's docs support that: such a suspension would show the boundary's fallback at once. If this holds in a browser, the blocking loader is the only mechanism for rule 2.
- **Awaiting.** The series recommends never awaiting; the sibling page and #147 rely on awaiting. For Cup's rules the sibling page and #147 are right, because the non-awaited form bypasses `pendingMs` (see the table above).
- **Default boundaries.** The series says every route has its own Suspense boundary by default; the sibling page's reading (only with a pending component or `wrapInSuspense`) matches the installed code.

## Limits

- Nothing was run in a browser, WebView or on a phone. The transition finding, the second row of the awaiting table, the stale `_ctx` after an account change, and the background refetch after a slow touch preload are derived from source and docs.
- The route `context` function is not in the TanStack Router guides; its behaviour here comes from source only and may change in a minor release.
- Line links point to the commits named above; the TanStack/store and React files were read from `node_modules` only.
