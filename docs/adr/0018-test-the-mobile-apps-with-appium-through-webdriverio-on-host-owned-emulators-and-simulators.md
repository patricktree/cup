---
status: accepted
---

# Test the mobile apps with Appium through WebdriverIO on host-owned emulators and simulators

What the Android and iOS shells add to the shared web app (share intake, the Android back button, native sign-in, session storage, native networking through `CapacitorHttp`) was checked only by hand, and the shells hardcoded `https://cup.audio`, so no build could reach a local test Worker. Patrick decided between 2026-11-06 and 2026-11-09 how the shells are tested automatically: the tool and runner in [patricktree/cup#184](https://github.com/patricktree/cup/issues/184), how a test build reaches the test Worker in [patricktree/cup#182](https://github.com/patricktree/cup/issues/182), and sign-in in [patricktree/cup#183](https://github.com/patricktree/cup/issues/183), collected in the spec [patricktree/cup#199](https://github.com/patricktree/cup/issues/199). The Android launch test of [patricktree/cup#200](https://github.com/patricktree/cup/issues/200) implemented the first slice.

## Decision

- **Appium through WebdriverIO drives both shells.** It is the only option that drives system UI (share sheets, Google's add-account screen, the back button) and reads the WebView's DOM on both platforms, in TypeScript, with every port set by the suite. Appium 3.9 is pinned exactly, with the UiAutomator2 8.x and XCUITest 12.x drivers.
- **Vitest runs the suite, with WebdriverIO's standalone `remote()` client.** It is the repository's runner, and its shared configuration keeps retries at 0.
- **Tests run on the developer's Mac, on emulators and simulators the suite owns.** Docker cannot host either platform on macOS (no `/dev/kvm` for the Android emulator, no iOS simulator outside macOS). Each run boots its own devices and servers on ports the operating system assigns and never attaches to another run's. There is no device farm and no CI; the suite runs in `pnpm validate:extended`.
- **No native UI-test targets.** No `androidTest` source set and no Xcode UI-testing bundle: Appium's drivers already are UI Automator and an XCTest bundle, so a native target would reach no UI that Appium cannot.
- **The debug build is the test build.** The suite launches the installed debug build with the test Worker's origin as a launch argument (an Android intent extra, an iOS process argument). Only debug native code reads it, sets a global the web app's `apiOrigin()` reads, and allows plain HTTP to `localhost`. Release builds carry none of it. The web bundle under test is the production build.

## Considered options

- **Maestro.** Rejected: YAML flows, it sees the WebView only as accessibility nodes, and it uses fixed ports.
- **Playwright for Android.** Rejected: experimental, and no iOS.
- **Espresso and XCUITest suites, or a mix of tools.** Rejected: two languages and two harnesses for one set of journeys, and neither reaches more system UI than Appium.
- **WebdriverIO's own testrunner.** Rejected: a third test runner in the repository, with its own retry settings.
- **A per-run test web bundle or native build.** Rejected: slow, and it tests a different bundle from the one that ships.
- **Capacitor `server.url` pointed at the test Worker.** Rejected: the shell would stop loading its bundled assets.
- **A real Google sign-in, a seeded session, or the [ADR 0012](0012-offer-a-local-test-account-instead-of-google-in-development.md) local test account.** Rejected: a real Google account on the emulator needs a committed debug keystore, a test Google Cloud project and a hand-prepared snapshot; a seeded session skips the code under test; the local test account bypasses the native sign-in paths. The suite signs in against the test Worker's fake auth provider instead.

## Consequences

- The suite needs Android Studio with the `google_apis` arm64 API 36 system image, Java 21 and Xcode on the Mac that runs `pnpm validate:extended`; a preflight check names what is missing.
- A change to Safari's Share Sheet or Google's add-account screen fails the suite. That is the signal to update the test, not flakiness to retry.
- Checks that need a physical device, a release-signed build or a real Google account stay manual.
- The [mobile E2E suite's guide](../../qa/mobile-e2e/README.md) describes how to run it.

## Notes

- 2026-11-10: the evidence behind this decision is in the research pages [Mobile E2E tools](../research/mobile-e2e-tools.md), [Emulators and simulators on macOS](../research/mobile-emulators-simulators-macos.md), and the two investigations of a real Google sign-in, [Native Google sign-in testing](../research/native-google-sign-in-testing.md) and [Google sign-in on an Android emulator](../research/google-sign-in-android-emulator.md).
- 2026-11-10: iOS sign-in did not work in the app during implementation, because Capacitor opens the auth page in Safari, which cannot return to `capacitor://localhost` ([CUP-60](https://linear.app/cup-audio/issue/CUP-60)). The iOS tests therefore run signed out, and only Android signs in against the fake auth provider ([decision](https://github.com/patricktree/cup/issues/199#issuecomment-6750104550)). The iOS debug build also reads the test Worker's origin from a `UserDefaults` key the suite writes, so a URL that cold-starts Cup reaches the test Worker; it was added for the Share Sheet tests in [patricktree/cup#206](https://github.com/patricktree/cup/issues/206). The suite landed in [patricktree/cup#211](https://github.com/patricktree/cup/pull/211).
