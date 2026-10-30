# Loading state recorder

Tests that guard against a loading flash use this recorder (`@cup/loading-state-recorder`). [`recordLoadingStates`](src/loading-state-recorder.ts) adds a `MutationObserver` to a Playwright page before it loads and records every element carrying `data-loading-state` or `data-pending-signal` that the page inserts, however briefly it stays. `readLoadingStateRecord` returns the record for a test to assert on.

Call `recordLoadingStates` before the page navigates or mounts a story; the record starts empty on each document. The web app sets the markers ([loading states](../../docs/architecture/web-app.md#loading-states)), and the gallery component tests and the [E2E journey](../e2e/test-e2e/navigation.test.ts) use the recorder. Its own tests run on a blank page, without the app, and need Docker like the other Playwright suites.
