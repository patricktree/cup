# Detecting a single-frame loading state in Playwright

> Historical research, incorporated 2026-10-30. Cited as rationale by [ADR 0016](../adr/0016-keep-the-query-cache-for-the-page-lifetime-and-load-screens-in-route-loaders.md), built in [#165](https://github.com/patricktree/cup/pull/165) as the [loading state recorder](../../qa/loading-state-recorder/README.md); see [loading states](../architecture/web-app.md#loading-states). Cup differs from the suggestions below: the markers are `data-loading-state` and `data-pending-signal`, since `data-loading` stays on cover images, which are not loading states, and revisit tests also install a clock and advance it past suspense's one-second `gcTime` floor, which this page does not cover. `createAppRouter` now sets the `pendingMs`, `pendingMinMs` and `viewport` preloading this page describes as still to come. Repository observations below describe `664dba9`.

[Original investigation](https://github.com/patricktree/cup/blob/fbbedd56ebb21870d00385124bd9be437cbe274a/docs/research/playwright-loading-flash-detection.md).

Research date: 2026-10-29. Question: [issue #155](https://github.com/patricktree/cup/issues/155).

How can a Playwright test in this repository reliably detect that a loading state (a route's pending component, a skeleton, or "Loading tracks…") appeared during a navigation in `apps/web-app`, even if it showed for only one frame, and where can such a test run?

## Sources and limits

Installed versions checked in `node_modules/.pnpm` of this checkout at `664dba9`: `@playwright/test`, `playwright` and `playwright-core` 1.64.0 (the only Playwright version installed); `@tanstack/react-router` 1.170.42, `@tanstack/router-core` 1.171.35, `@tanstack/history` 1.162.5; `@tanstack/react-query` and `@tanstack/query-core` 5.104.1; `react` and `react-dom` 19.3.0 with `scheduler` 0.28.0; `msw` 3.0.3. Code claims below come from those installed packages; function names are given because line numbers drift.

Spec claims come from the [DOM Standard](https://dom.spec.whatwg.org/#queueing-a-mutation-record) and the [HTML Standard's event loop processing model](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering), read on 2026-10-29, and from [MDN on `PerformanceElementTiming`](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming).

Experiments ran on 2026-10-29 as throwaway component tests in `apps/web-app`, through the repository's Playwright configuration, so the browser was the Docker Playwright Server's Chromium reached with `connectOptions` (no `PWDEBUG`). They ran on both projects (`desktop-chromium`, `mobile-chromium`), five repetitions each, 90 of 90 passing. See [Reproduction](#reproduction). Not run: anything against the app E2E suite in `qa/e2e`, WebKit or Firefox, the Capacitor shells, CDP screencast or Chromium tracing, and a route with the planned `queryClient.query({ staleTime: 'static' })` loaders (the app routes don't have them yet, so the router experiment used its own minimal route tree).

## Summary

- A `MutationObserver` registered with `page.addInitScript` on `document` (`childList`, `subtree`) records every insertion of a marked element, including one inserted and removed in the same task, which no paint can show. It answers "was it ever rendered into the DOM", not "was it painted". For a guard against a flash that is the stricter and more useful question: the app should never insert a loading element on a cached navigation.
- Sampling with `requestAnimationFrame` approximates "was it in a rendering update", catching only elements that survive until a frame. It misses same-task, microtask and `setTimeout(0)` flashes, and under a paused `page.clock` it stops entirely, because Playwright fakes `requestAnimationFrame`.
- Holding the response is the timing-independent lever. In the gallery, MSW handlers run in the page, so a handler that awaits a promise the test resolves through `page.evaluate` holds the response for as long as the test wants. `page.route` cannot see those requests, because the mock service worker answers them; `page.route` is the lever in `qa/e2e`, where it already intercepts every request.
- `page.clock` drives TanStack Router's `pendingMs` and `pendingMinMs` exactly, since both use `Date.now()` and `setTimeout`. In the experiment the pending component appeared at fake 500 ms, not at 499 ms, and stayed until fake 800 ms, however long the test waited in real time.
- A paused clock also freezes TanStack Query: its `notifyManager` delivers results with `setTimeout(cb, 0)`, so a released response reaches components only after `runFor`. React itself keeps rendering, because its scheduler uses `MessageChannel`, which the clock does not fake; React's Suspense reveal throttle (300 ms) uses `setTimeout` and is clock-controlled.
- With real timers, `pendingMs` 500 hides a slow navigation from any test whose data arrives in under 500 ms. On a fast machine a broken cache still passes a "no pending component" test, so that test must not depend on the response being slow. Hold the response instead: with the cache working, the destination renders while the response is held; with it broken, it never does.
- The UI gallery already hosts the real app router with memory history and the real module-level `QueryClient` (`accountStory` in [`account-fixtures.tsx`](../../apps/web-app/src/ui-gallery/account-fixtures.tsx)), so navigation and cache tests fit the component tests. They run the Vite development build in React Strict Mode; `qa/e2e` runs the production build against the Worker.
- `page.route`, `page.addInitScript` and `page.clock` all work through the shared Playwright Server container: route handlers and init scripts are protocol features, and the clock is installed server-side as context init scripts. The experiments used all three through `connect`, and both suites already use the first two.
- Neither suite covers WKWebView (iOS) or Android System WebView. The detection mechanisms are web standards, but timing is not portable: what these suites can prove is the engine-independent invariant (a cache hit inserts no loading element), not the frame-level experience on a device.

## Detection techniques

### MutationObserver from an init script

The DOM Standard queues a mutation record as part of the insert and remove algorithms and delivers the observer's whole record queue in a microtask ("queue a mutation observer microtask", then "notify mutation observers"). Notification does not check whether the node is still connected, so a node inserted and removed before the microtask still produces both records ([DOM Standard, 4.3](https://dom.spec.whatwg.org/#queueing-a-mutation-record)).

`page.addInitScript` runs "after the document was created but before any of its scripts were run" (Playwright 1.64 `Page.addInitScript` docs), so an observer on `document` sees the app's first render. It does not run for `page.setContent` (observed: the recorder was undefined), so the page must be loaded by navigation. The `mount` fixture of Playwright 1.64 does that: it calls `page.goto(baseURL)` and then `window.mount()` (`playwright/lib/index.js`, `mount` fixture), so init scripts and the clock registered before `mount()` apply.

Observed (plain page, Docker Chromium, every run): the observer recorded all four cases (inserted and removed in the same task, after one microtask, after `setTimeout(0)`, after two animation frames).

Cost:

- A stable marker on every pending and loading element, such as `data-loading` or a role and name. Matching on text ("Loading tracks…") worked in the experiment but couples the recorder to copy.
- The recorder must check descendants of added nodes, because React often inserts a subtree whose root is not the marked element.
- It reports insertions, not paint. A test that wants "never visible to the user" gets a stronger check than it asked for; one that tolerates an unpainted insertion has to sample frames as well.
- The observer must be created before the app renders; `page.addInitScript` guarantees that.

### Frame sampling and paint-based signals

The HTML Standard's "update the rendering" runs animation frame callbacks (step 14) before style and layout and, last, updates the rendering of the document ([HTML Standard, 8.1.7.3](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering)). An element present in a `requestAnimationFrame` callback is therefore part of that rendering update. The standard also lets the user agent skip rendering opportunities (hidden documents, "unnecessary rendering", other reasons), so presence at a frame callback is not proof of pixels on screen.

Observed (plain page, every run): the rAF sampler saw only the element kept for two frames, never the same-task, microtask or `setTimeout(0)` case. In the gallery the real "Loading tracks…" line of the `EmptyRecents`-like story was present in one or two animation frames on a fast run: the observer and the sampler both caught it, while the final-state assertion passed.

Under `page.clock.install()` Playwright replaces `requestAnimationFrame` with a fake driven by the fake clock (`createApi` in the injected clock, `playwright-core/lib/coreBundle.js`); observed: no frame callbacks while paused, three per `runFor(50)`. A rAF sampler and a paused clock cannot be combined.

Element Timing (`PerformanceObserver` with `type: "element"` and an `elementtiming` attribute) is the only paint-based DOM API for arbitrary text: MDN lists text-node groups as eligible and marks it experimental and limited in availability. Observed: no entries at all in Docker Chromium for text elements kept for two frames; not investigated further.

`page.screencast` (Playwright 1.64, JPEG frames at a chosen `fps`) and `browser.startTracing` (Chromium-only, with screenshots) record what was composited, but sample at their own rate, are Chromium-only for tracing, and need image analysis to find the marker. They suit diagnosis, not a pass/fail guard.

## Controlling time and responses

### Holding a response

In the gallery, MSW's mock service worker posts each request to the page, where the handlers run (`mockServiceWorker.js` `REQUEST`/`MOCK_RESPONSE` messages). A handler can therefore await a promise that the test resolves:

```ts
http.get("/api/account/conversions", async () => {
  await new Promise((resolve) => Object.assign(window, { releaseRecents: resolve }));
  return HttpResponse.json({ items: [], nextCursor: null });
});
```

Observed: the loading line stayed visible until the test called `releaseRecents()`, independent of machine speed. MSW's `delay(ms)` and `delay("infinite")` use the page's `setTimeout` (`msw/src/utils/delay.ts`), so they are clock-controlled when `page.clock` is installed and real-time otherwise.

`page.route` does not see requests a service worker answers; Playwright recommends `serviceWorkers: "block"` when intercepting (Playwright 1.64 `BrowserContext.route` docs). The gallery's `account-session`, `api-request` and `account-conversions` component tests block service workers and use `page.route` instead of MSW; route stories with `accountStory` need the worker, so they hold responses with MSW handlers.

In `qa/e2e`, the `page` fixture routes `**/*` to reject unapproved origins ([`fixtures.ts`](../../qa/e2e/test-e2e/fixtures.ts)), and tests add narrower routes; later registrations run first ("in the order opposite to their registration", Playwright 1.64 docs). A test holds a Worker response with `page.route(url, async (route) => { await released; await route.fallback(); })`, so the guard still sees it, or `route.continue()`. The handler runs in the test process, so each held request costs a round trip over the Playwright connection. Holding on the server would need a test-only hook in the QA Worker ([`qa/e2e/src/worker.ts`](../../qa/e2e/src/worker.ts)); nothing in it does that today, and the browser-side hold needs none.

### The clock

`page.clock.install()` fakes `Date`, `Temporal.Now`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`, `performance` (and `Intl` and `AbortSignal.timeout`) in the main world of every frame (`platformOriginals` and `createApi` in the injected clock). It does not fake `MessageChannel`, microtasks, `fetch` or workers. It is installed through context init scripts plus an evaluation in existing frames (`Clock._installIfNeeded`), so it must be installed before navigation for code that captures timer functions at module load: React's scheduler and React DOM capture `setTimeout` (`localSetTimeout`, `scheduleTimeout`) and `performance` when their modules evaluate. Playwright's docs recommend installing before navigating and pausing once the page has loaded.

What a paused clock does to this stack:

- TanStack Router: `offerPending` in `router-core/src/load-client.ts` computes the reveal deadline as the transaction's `Date.now()` start plus `pendingMs` and arms a `setTimeout`; after the pending component commits, it sets a deadline of `Date.now() + pendingMinMs`, which `awaitPendingMinimum` waits out with `setTimeout`. Observed with `pendingMs` 500 and `pendingMinMs` 300 under a paused clock: no pending component after a real second, none after `runFor(499)`, visible after `runFor(1)`; after the loader resolved it stayed through `runFor(299)` and gave way after `runFor(1)`, the observer timestamps reading fake +500 ms and +800 ms. With real timers, a loader resolved at once never inserted the pending component (10 of 10), and one resolved after about 600 ms showed it for 300.7–309.3 ms (12 runs).
- TanStack Query: `notifyManager`'s default scheduler is `systemSetTimeoutZero` (`query-core/src/notifyManager.ts`, `timeoutManager.ts`), so observers learn of new results only when a 0 ms timer fires. Observed: with the clock paused, a released Recents response left "Loading tracks…" on screen for a real second; `runFor(10)` rendered the list. Tests that pause the clock must advance it after every data event they expect the UI to show, or set the clock running again with `resume()`.
- React: the scheduler posts work through `MessageChannel` (`scheduler.development.js`, `schedulePerformWorkUntilDeadline`), so renders and commits continue while paused. A paused `performance.now()` means the scheduler never yields mid-render, which is harmless. React DOM delays revealing content that replaces a Suspense fallback until 300 ms after the fallback was shown (`FALLBACK_THROTTLE_MS`, armed with `scheduleTimeout`), so that reveal also waits for the clock (read, not tested).
- App timers: polling with `refetchInterval` (Recents, the detail view, the reader) and the Supabase client's token auto-refresh (`autoRefreshToken: true` in `account-session.ts`) stop while paused, and `Date.now()` stays where it was paused, so a fixture's token expiry should stay far in the future (the fixtures use 2100).

One anomaly: in one early run of a combined probe, a 0 ms timer registered after `pauseAt` fired without `runFor`; a dedicated probe and all later runs showed timers frozen as the source says. Cause unknown.

### What the planned timings mean for a test

The planned router has `pendingMs` 500, `pendingMinMs` 300 and a top progress bar that appears 100 ms after a navigation starts. With real timers:

- A navigation that resolves within 100 ms shows nothing; within 500 ms only the progress bar; later, the pending component for at least 300 ms. The router never produces a one-frame flash of its pending component: once shown, it stays 300 ms.
- One-frame flashes come from elsewhere: a component's own loading branch, such as `recents.isLoading && <output>Loading tracks…</output>` in [`_shell.recent.tsx`](../../apps/web-app/src/routes/_shell.recent.tsx), or a suspense hook that suspends on a cache miss. When a route has a `pendingComponent`, `Match.tsx` wraps its content in `React.Suspense` with that component as the fallback, so a suspending component shows the pending component at once, without `pendingMs`. The current `gcTime: 0` in [`query-client.ts`](../../apps/web-app/src/data-fetching/query-client.ts) makes such misses possible, since a query without observers is removed as soon as it is no longer used.
- A real-time test that asserts "no pending component" passes whenever the response arrives within 500 ms, which with local MSW or Wrangler is nearly always, even if the cache is broken. It would fail only on a slow run. The fix is to remove the race: hold the destination's responses, navigate, assert the destination content is visible while the responses are still held, and assert the observer recorded no marked element. A broken cache then fails on every run, fast or slow, because the content never renders. No clock is needed for that.
- The clock is for asserting the timings themselves: that the progress bar appears at 100 ms and not before, that the pending component appears at 500 ms and stays 300 ms. Pause after load, navigate, step with `runFor`, and check with `expect(...).toBeVisible()` or `toHaveCount(0)`, which poll in the test process.
- With `defaultPreload: 'viewport'`, links that enter the viewport preload their loaders (through `IntersectionObserver`, not timers). A held handler holds preloads too, and a test must decide whether a preload counts: to model a revisit, warm the cache by visiting first, then hold every later response.

## Where the tests can run

### Component tests against the UI gallery

[`playwright.config.ts`](../../apps/web-app/playwright.config.ts) starts `pnpm run dev:gallery --port 0` and points `baseURL` at the gallery canvas; the gallery mounts stories through `window.mount` ([`ui-gallery/main.tsx`](../../apps/web-app/ui-gallery/main.tsx)), and Playwright 1.64's built-in `mount` fixture calls it. `accountStory` creates the app router with `createAppRouter(createMemoryHistory(...))` and renders `GlobalProviders`, which installs the module-level `queryClient`. A test can therefore navigate inside one mount (click links, or `window.goBackInAccountStory()` for Back) with the real cache and router options. Each `mount()` reloads the page, so tests do not share cache state.

Costs: it runs the Vite development build under `React.StrictMode`, so effects run twice and render timing differs from production; network is MSW, so holds belong in handlers; and `createAppRouter` currently sets `defaultPendingMs: 0`, `defaultPendingMinMs: 0` and `defaultPreload: "intent"`, which the planned change replaces.

### App E2E suite in `qa/e2e`

Each test starts its own `wrangler dev` on a port the OS assigns, serving the built web app and the QA Worker with deterministic fakes ([README](../../qa/e2e/README.md), [`fixtures.ts`](../../qa/e2e/test-e2e/fixtures.ts)). The browser runs in the shared Playwright Server container, which uses host networking, so it reaches `127.0.0.1:<port>` ([config-playwright README](../../.patricktree-stack/tooling/config-playwright/README.md), `playwright-server-global-setup.ts`). Responses are held with `page.route` as above; the web app registers no service worker, so routing sees every request. `page.clock` fakes only the browser: the Worker, Durable Objects and Workflows keep real time. This level proves the production bundle and real API shapes, at the cost of a Wrangler start per test and more moving parts.

### Remote browser through `connect`

`createPlaywrightDockerConfig` sets `use.connectOptions.wsEndpoint` to the container's `playwright run-server` ([`playwright-docker.ts`](../../.patricktree-stack/tooling/config-playwright/playwright-docker.ts)). Route handlers run in the test process and are called over the connection; init scripts are sent to the server; `page.clock` is implemented by the server's `Clock` class through `addInitScript` and frame evaluation. All three worked in the experiments through this connection. `PWDEBUG=1` runs a local browser instead, which changes timing but not these APIs.

### Capacitor shells

Both projects in both suites are Chromium. The iOS shell uses WKWebView, which Playwright cannot drive (its WebKit build is not WKWebView), and the Android shell uses Android System WebView, which Playwright 1.64 supports only through its experimental `_android` API with a connected device or emulator. Nothing in the repository uses either. MutationObserver and the event loop are standard, so an "inserted no loading element" invariant proven in Chromium carries over as far as the app logic is engine-independent; frame timing, native bridge latency (for example secure storage during session start) and device speed do not.

## Reproduction

The [experiment archive](playwright-loading-flash-detection.tar.xz) contains the five throwaway files and the output of one run on `desktop-chromium`:

- `src/zz-flash-experiment.test.ts`: plain page served with `page.route`; observer, rAF sampler and Element Timing against same-task, microtask, `setTimeout(0)` and two-frame flashes, with and without a paused clock.
- `src/routes/zz-flash-experiment.story.tsx` and `.test.ts`: Recents through `accountStory`, fast and with a held MSW response, with and without a paused clock.
- `src/routes/zz-router-experiment.story.tsx` and `.test.ts`: a minimal TanStack Router tree with `pendingMs` 500, `pendingMinMs` 300 and a loader the test resolves, under a paused clock and in real time.

Copy the `src` folder over `apps/web-app/src` and run, with Docker running:

```sh
tar -xJf docs/research/playwright-loading-flash-detection.tar.xz -C /tmp
cp -R /tmp/playwright-loading-flash-detection/src/. apps/web-app/src/
pnpm --filter '@cup/web-app' exec playwright test zz- --reporter line
```

Delete the copied `zz-*` files afterwards.
