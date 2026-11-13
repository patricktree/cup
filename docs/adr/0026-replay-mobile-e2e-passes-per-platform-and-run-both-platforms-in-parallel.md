---
status: accepted
---

# Replay mobile E2E passes per platform and run both platforms in parallel

[ADR 0024](0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md) moved the app and source-material E2E suites into the Turbo cache but left the mobile suite running fresh, and [ADR 0020](0020-validate-in-three-local-gates-that-trust-the-turbo-cache.md) had the deploy gate run Android and iOS one after the other until five consecutive warm parallel runs passed. Those five runs passed ([#301](https://github.com/patricktree/cup/issues/301)). The spec [#303](https://github.com/patricktree/cup/issues/303) described the change and [#305](https://github.com/patricktree/cup/issues/305) built it. This supersedes ADR 0020's sequential mobile platforms and extends ADR 0024 to the mobile suite.

## Decision

- **Each platform is a cached Turbo task.** `@cup/mobile-e2e` has `turbo:e2e:android` and `turbo:e2e:ios`, each running one Vitest project, with caching on and no file outputs. `pnpm test:e2e:mobile` runs both through `turbo run`, which starts them at the same time; `test:e2e:mobile:android` and `test:e2e:mobile:ios` run one. A platform whose inputs are unchanged is replayed, the other runs.
- **The native app is in the hash through a package dependency.** `@cup/mobile-e2e` depends on `@cup/mobile-app`, so `^turbo:build` includes `@cup/mobile-app#turbo:build`, whose hash covers the tracked Android and iOS projects, the Capacitor configuration, the Capacitor and plugin versions, and the web app the shells ship ([inputs audit](https://github.com/patricktree/cup/issues/299)). Narrower globs per platform were not used: explicit globs ignore `.gitignore`, so they would have to exclude build folders and the copied web bundle by hand. A native change on one platform therefore also misses the other.
- **Each platform's toolchain enters the hash as its own key.** The uncached reader `turbo:e2e:toolchain` writes `.toolchain/android.json` and `.toolchain/ios.json`, reusing the preflight check's lookups, and each platform task hashes only its own file as a just-in-time input, as in ADR 0024. iOS: the Xcode version and build, the simulator runtime the preflight picks (identifier, version, build) and the macOS version and build. Android: the revisions of Platform-Tools, the SDK platform that the mobile app's `compileSdkVersion` in `variables.gradle` names (36), the emulator (with its build ID) and the system image, the runtime version and vendor of the JDK Gradle uses, and the macOS version and build. A version that cannot be read is written as the reason plus a random value, so that platform misses and its preflight reports the problem. _Note, 2026-11-13:_ as in [ADR 0024](0024-replay-e2e-suite-passes-from-the-turbo-cache-with-a-toolchain-key.md), the reader now writes the reason alone, and each platform task first checks its own key file and fails before any emulator, simulator or Appium starts when a version in it is unreadable ([#312](https://github.com/patricktree/cup/pull/312)). The reader still writes both files, so an unreadable Android toolchain fails only the Android task and iOS still runs.
- **Ignored files the run reads are inputs.** Android lists `apps/mobile-app/android/local.properties`, where Gradle can find the SDK; both list the test Worker's `.env.local`. The variables that locate the toolchains (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, `JAVA_HOME`, `DEVELOPER_DIR`) and the debugging flags pass through unhashed, since the key hashes what they point to.
- **The deploy gate runs both platforms in one step**, `pnpm run test:e2e:mobile`, so Turbo runs them in parallel.

## Considered options

- **Keep the parallel runner `src/run-e2e.ts` behind one cached task for both platforms.** Rejected: an Xcode update or an iOS-only test change would rerun Android too, and a failure on one platform would cache nothing for the other.
- **Write the keys in the preflight check of each platform's global setup.** Rejected: a cache hit never reaches the global setup, so the key must come from a task Turbo runs before hashing.
- **`dependsOn: ["@cup/mobile-app#turbo:build"]` instead of a package dependency.** Equivalent for the hash, but the package dependency states the relation where the workspace graph and `turbo ls --affected` see it; Knip needs it listed as an ignored dependency, since no module imports the app.

## Consequences

- A change to `apps/mobile-app`, its plugins or the web app misses both platforms; a change to `test/android/` or `test/ios/` misses only its platform; any other change in `qa/mobile-e2e` misses both.
- Turbo prefixes each line of a platform's output with its task name, in place of the runner's `[android]` and `[ios]`.
- `cap sync` rewrites tracked files of `apps/mobile-app`. If a run ever changes them, the next run misses; it cannot replay a stale pass.
- Machine-wide caches (the emulator snapshot, WebDriverAgent builds, `.appium`) follow from pinned versions and the hashed toolchain, so they are not inputs.
- The Android Gradle and iOS build outputs stay in the checkout and are not restored on a hit; nothing reads them after a run.
