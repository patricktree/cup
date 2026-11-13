# Toolchain key

This CLI writes the versions of the host toolchain an E2E suite runs on to a key file and checks that each version was read. Each cached E2E Turbo task hashes its key file, so a pass recorded on one toolchain is never replayed on another; [ADR 0024](../../docs/adr/0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md) records the design. The mobile E2E suite writes its Android and iOS keys with its own reader, which reuses the suite's preflight lookups ([mobile E2E tests](../../qa/mobile-e2e/README.md#cached-passes)) and this package's [`key-file`](src/key-file.ts) export for unreadable versions and writing key files.

## Usage

```sh
toolchain-key playwright --output .toolchain/playwright.json
```

`playwright` writes the base image tag and the ID of the Playwright Server image that [`@patricktree-stack/config-playwright`](../../.patricktree-stack/tooling/config-playwright/README.md) runs the browsers in. It derives the image tag as that package's global setup does and, when the image is missing, builds it the same way first, so the key of a machine's first run matches the key of its later runs and the suite's global setup finds the image built.

A version that cannot be read is written as `{ "unreadable": "<reason>" }` in its place, so the reader still writes every other version. The `playwright` command fails only when it cannot write the file.

## Checking a key file

```sh
toolchain-key check .toolchain/playwright.json --suite 'app E2E'
```

`check` fails unless the key file exists, holds valid JSON and has no unreadable version at any depth. Its message names the suite, the key file and every unreadable version with its path in the key and its reason, for example `serverImage.id: docker image inspect …: …`. Each cached suite task runs it before its suite, so the suite fails in about a second instead of starting servers, devices or browsers, and a pass is never cached under a key that does not describe the toolchain ([ADR 0024](../../docs/adr/0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md)). Code can call the same check as `assertReadableKeyFile` from the [`key-file`](src/key-file.ts) export.

## Wiring a suite

An E2E package adds a `turbo:e2e:toolchain` script that runs this CLI, starts its `turbo:e2e` script with `toolchain-key check <key file> --suite <name> &&`, and configures its `turbo:e2e` task to depend on the reader and hash the key file as a `mode: "jit"` input, which Turbo hashes after the reader has run; see [`qa/e2e/turbo.jsonc`](../../qa/e2e/turbo.jsonc). The key file must be Git-ignored (the root `.gitignore` ignores `**/.toolchain`), so it stays out of the reader task's own default inputs.

## Validation

Run `pnpm --filter @cup/toolchain-key test` and `lint`. The [key file tests](test/key-file.test.ts) cover the check: a readable key, nested unreadable versions, a missing file and invalid JSON. One Playwright test points Docker at a socket that does not exist and checks that the key holds the reason and is the same on every run; another puts a fake `docker` without the image first on the `PATH` and checks that the first run builds it and writes the same key as the second.
