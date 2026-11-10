# Test Worker

This package holds the test-only Worker that the E2E suites run against, the helper that starts it, and the fake auth provider. The [application E2E tests](../e2e/README.md) and the [mobile E2E tests](../mobile-e2e/README.md) use it; a change to a fake or to the harness lands here once for every suite.

- The [Worker entry](worker/worker.ts) runs the production API server, Durable Objects and Workflows, and replaces source-material preparation, narration selection, and speech synthesis with deterministic fakes. Each fake belongs to the production library whose boundary it implements. The `QA_SCENARIO` variable selects how the fakes behave, such as a failing speech provider. Its [Wrangler configuration](wrangler.jsonc) serves the built web app from the Worker's assets.
- [`startTestWorker`](src/test-worker.ts) starts one `wrangler dev` process on a port the operating system assigns, with its own persistence directory. A suite starts one per test, so tests can run in parallel and in several checkouts at once. The Worker entry logs each request it receives, and the helper reads that log back, so a suite can check what its client sent. The helper can restart the Worker with another scenario, create a conversion grant through the operator API, and keep the persistence directory after a failed test.
- [`startAuthProvider`](src/auth-provider.ts) is a local stand-in for Supabase Auth: real PKCE, signed access tokens and JWKS, with no Google traffic. Pass its origin to `startTestWorker` so the Worker verifies its tokens; its origin is also its token issuer. By default it listens at `http://127.0.0.1:<port>`, where the web suite's browser reaches it. With `hostname: "localhost"` it listens on both the IPv4 and the IPv6 loopback and issues tokens for `http://localhost:<port>`, as the mobile suite needs.
  - For native Google sign-in, it stands in for Google too: `POST /qa/google-id-token` returns a Google ID token carrying the nonce it was sent, and the `grant_type=id_token` exchange accepts that token only with the raw nonce whose SHA-256 hash it carries, then returns the same Google-provider session as the PKCE exchange. The Android debug build's sign-in fake calls the first; the web app's `signInWithIdToken` calls the second.

The Worker serves `apps/cloudflare-worker/dist/client`, so build the workspace before a suite starts it.

The package's own [Vitest tests](test/) check the fake auth provider, such as its reachability over both loopbacks and the nonce check of the ID token exchange; `pnpm validate:fast` runs them.

## Cost and network boundary

This boundary applies to every suite that uses this package. The test Worker has no Cloudflare AI binding and refuses to run a workflow when an AI binding or Cloudflare credential reaches it. The helper removes Cloudflare account credentials from each Wrangler child process. Do not add a paid-provider binding or a real provider call to this package. A local deterministic fake is the required test seam, even when it gives less confidence than a paid integration test.

Each suite also keeps its client from reaching other hosts; the web suite rejects unexpected browser requests.
