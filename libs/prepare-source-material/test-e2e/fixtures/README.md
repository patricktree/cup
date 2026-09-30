# Recorded source pages

These fixtures capture the Anthropic, Cloudflare, and Gates Notes pages on 2026-09-30, before source-material cleanup. Each JSON file contains the original response URL, HTTP status, content type, and decoded response body for the page and its completed first-party HTML, JavaScript, CSS, and content API requests. Cloudflare's search modules are also included because the page imports them.

The fixture server serves these responses locally. The test browser adapter intercepts requests at their original public URLs and fulfills them from that server, preserving production URL validation and relative URL resolution. No browser request falls through to the internet. Images, fonts, video, and third-party analytics are blocked; missing recorded application resources fail the test.

Gates Notes retains its original empty HTML shell, Next.js bundles, and content API responses. Its test verifies that disabling JavaScript leaves the shell empty and that enabling JavaScript produces the article. Serving an already rendered DOM would lose this coverage.

Run the suite from the repository root:

```sh
pnpm test:e2e:source-material
```

The expected cleaned HTML lives beside the test in `../anthropic.html`, `../cloudflare.html`, and `../gates-notes.html`. Update those snapshots only for intentional preparation changes:

```sh
pnpm --filter '@cup/prepare-source-material' test:e2e:update
```

Publisher changes do not require refreshing these fixtures. When deliberately capturing a newer publisher implementation, record a Playwright browser context with `recordHar: { content: "embed", mode: "minimal", path: "capture.har" }`, wait for the article and `networkidle`, then close the context to flush the recording. Keep successful HTML, JavaScript, CSS, and JSON responses from the hosts listed in `createFixtureBrowser`, decode base64 bodies if necessary, and deduplicate by URL into the existing response format. Review changes to the raw inputs and cleaned snapshots together. Preserve the empty Gates Notes navigation response and its scripts rather than replacing them with rendered HTML.
