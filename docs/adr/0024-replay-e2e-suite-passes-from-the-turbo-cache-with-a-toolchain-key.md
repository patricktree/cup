---
status: accepted
---

# Replay E2E suite passes from the Turbo cache with a toolchain key

[ADR 0020](0020-validate-in-three-local-gates-that-trust-the-turbo-cache.md) let every gate trust the Turbo cache but kept the E2E suites outside Turbo, so they ran fresh in every gate. The deploy gate therefore reran app E2E on code the merge gate had already tested, about 5 of its 13 to 21 minutes ([baseline](https://github.com/patricktree/cup/issues/296)). The map [patricktree/cup#295](https://github.com/patricktree/cup/issues/295) decided the change, the spec [#303](https://github.com/patricktree/cup/issues/303) described it, and [#304](https://github.com/patricktree/cup/issues/304) built it for the app and source-material suites. This supersedes ADR 0020's "the E2E suites run outside Turbo and always run fresh" for those two suites.

## Decision

- **The app and source-material E2E suites are cached Turbo tasks.** Each package has a `turbo:e2e` task with caching on, and the root scripts `test:e2e:app` and `test:e2e:source-material`, which the gates run, call it through `turbo run`. A cache hit counts as a pass. The workspace build the suites need is the task's `^turbo:build` dependency instead of a `pnpm run build` in the root script.
- **The host toolchain enters the hash as a toolchain key.** Turbo hashes only files and environment variables, so an uncached reader task, `turbo:e2e:toolchain`, writes a Git-ignored key file that `turbo:e2e` depends on and hashes as a just-in-time (`mode: "jit"`) input, after the reader has run ([research](https://github.com/patricktree/cup/issues/298)). For the Playwright suites the key is the base image tag and the ID of the locally built Playwright Server image, so a rebuilt image misses; the reader builds the image when it is missing, so a machine's first run writes the key its later runs write. A version that cannot be read, such as the image with Docker stopped or a failed build, is written as a random value, so the task misses and the suite reports the problem itself.
- **Ignored files the suites read are listed as inputs.** Explicit inputs are hashed even when Git ignores them; app E2E lists the test Worker's `.env.local`, which Wrangler loads ([inputs audit](https://github.com/patricktree/cup/issues/299)). Variables that change what a pass means (`CI`, `PWDEBUG`) are hashed; variables that only locate Docker or turn on debugging output pass through unhashed.
- **The tasks have no file outputs.** Only the log is replayed. Playwright reports and traces hold the absolute paths of the checkout that ran them, and the cache is shared by every worktree on the Mac ([research](https://github.com/patricktree/cup/issues/297)).
- **The paid narration evals stay outside Turbo** and run fresh whenever the review gate runs them.

## Considered options

- **Hash toolchain versions through `env`, `globalEnv` or an eagerly hashed file written by a wrapper before `turbo run`.** Rejected: every entry point would need the wrapper, and a run without it hashes an unset variable or a stale file as if it were current, so it fails open.
- **A committed file of declared toolchain versions checked by the suite's preflight.** Rejected: a cache hit never reaches the preflight, and every toolchain update would need a commit.
- **Keep running the suites fresh and only make them faster.** Rejected as the only measure: a deploy right after a merge would still rerun app E2E on unchanged code.

## Consequences

- A replayed step shows `cache hit` in its output and a duration of seconds in the gate summary; how a gate should present it as evidence waits for [#302](https://github.com/patricktree/cup/issues/302).
- A file a suite reads outside its package and its declared dependencies can replay a stale pass. New reads across packages must be added to the task's `inputs` or reach it through a declared dependency.
- `turbo run turbo:e2e --only` skips the reader and hashes whatever key file the last full run left; the gates never pass `--only`.
- The reader derives and builds the Playwright Server image the same way the shared Playwright configuration does. If that derivation changes, the reader builds and keys an image the suite does not use, so a change to the suite's image no longer misses until the reader follows; a change to the shared configuration's global setup must be checked against the reader.
- `--force` on the root scripts runs a suite even when a pass is cached, for debugging with `E2E_RETAIN_STATE` or `E2E_STREAM_WRANGLER`.
