# Toolchain key

This CLI writes the versions of the host toolchain an E2E suite runs on to a key file. Each cached E2E Turbo task hashes its key file, so a pass recorded on one toolchain is never replayed on another; [ADR 0024](../../docs/adr/0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md) records the design. The mobile E2E suite writes its Android and iOS keys with its own reader, which reuses the suite's preflight lookups ([mobile E2E tests](../../qa/mobile-e2e/README.md#cached-passes)).

## Usage

```sh
toolchain-key playwright --output .toolchain/playwright.json
```

`playwright` writes the base image tag and the ID of the Playwright Server image that [`@patricktree-stack/config-playwright`](../../.patricktree-stack/tooling/config-playwright/README.md) runs the browsers in. It derives the image tag as that package's global setup does.

A version that cannot be read is written as the reason plus a random value, so the task hashing it misses the cache and the suite runs and reports the problem itself. The CLI fails only when it cannot write the file.

## Wiring a suite

An E2E package adds a `turbo:e2e:toolchain` script that runs this CLI, and configures its `turbo:e2e` task to depend on it and hash the key file as a `mode: "jit"` input, which Turbo hashes after the reader has run; see [`qa/e2e/turbo.jsonc`](../../qa/e2e/turbo.jsonc). The key file must be Git-ignored (the root `.gitignore` ignores `**/.toolchain`), so it stays out of the reader task's own default inputs.

## Validation

Run `pnpm --filter @cup/toolchain-key test` and `lint`. The test points Docker at a socket that does not exist and checks that the key differs on every run.
