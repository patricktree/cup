# Mobile E2E tests

This package drives the debug build of the Android shell on an emulator and of the iOS shell on a simulator with Appium through WebdriverIO, run by Vitest ([ADR 0018](../../docs/adr/0018-test-the-mobile-apps-with-appium-through-webdriverio-on-host-owned-emulators-and-simulators.md)). Each test launches the installed app against its own [test Worker](../test-worker/README.md) and checks what the listener sees in the WebView's DOM and which requests the Worker received.

## Prerequisites

- macOS on Apple Silicon
- Android Studio with these SDK packages, installed through its SDK Manager or `sdkmanager`:
  - Android SDK Platform-Tools, Android Emulator, and Android SDK Command-line Tools (latest)
  - SDK platform 36 and the system image `system-images;android-36;google_apis;arm64-v8a`
- Java 21, with `JAVA_HOME` pointing to it. Android Studio includes one at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`.
- Xcode that supports the host macOS, with an iOS simulator runtime: install one with `xcodebuild -downloadPlatform iOS` or in Xcode under Settings > Components. Since version 26, Xcode's major version must be at least macOS's: an older Xcode hangs every XCTest runner, WebDriverAgent included. After an Xcode update, restart CoreSimulatorService with `killall -9 com.apple.CoreSimulator.CoreSimulatorService`.
- Internet access on the first run, for the Appium driver and Chromedriver downloads, and on every run for the Android add-account test, which opens Google's real sign-in screen through Google Play services

The suite finds the SDK at `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then Android Studio's default `~/Library/Android/sdk`. A preflight check per platform fails the run before any device starts, naming each missing tool and how to install it, and the Xcode update or CoreSimulatorService restart the iOS run needs.

## One-time setup

There is none to do by hand. The first run on a Mac takes several minutes longer and says so in its output:

- It installs the pinned Appium drivers into the git-ignored `qa/mobile-e2e/.appium`. Later runs find it there; an interrupted installation is redone.
- It creates the suite's own emulator, `cup-mobile-e2e-api36`, in `~/Library/Caches/cup-mobile-e2e/avd`, boots it once and saves its Quick Boot snapshot. Every later run, in any checkout, boots a read-only instance from that snapshot in a few seconds. Delete the folder to rebuild the emulator, for example after a system image update.
- It builds the XCUITest driver's WebDriverAgent for the simulator into `~/Library/Caches/cup-mobile-e2e/wda`, in a folder named after the WebDriverAgent version and Xcode's build version. Every later run, in any checkout, starts that build with `xcodebuild test-without-building` and never rebuilds it; a new driver or Xcode version builds a new folder.

## Run the tests

From the repository root:

```sh
pnpm run test:e2e:mobile
```

This builds the workspace, then each platform syncs the production web bundle into its native project, builds the debug app (the APK with Gradle, the simulator app with `xcodebuild`), starts its device and Appium, installs the app and runs the specs one after another. The suite runs in `pnpm validate:extended` and `pnpm validate`, after the web E2E suites.

To run one platform, name its Vitest project:

```sh
pnpm run test:e2e:mobile --project android
pnpm run test:e2e:mobile --project ios
```

## Isolation

Runs in several checkouts can go at once. Each run boots its own emulator, which picks its own console port and reports it back, and addresses it by serial; it never kills the shared adb server or touches a device it did not start. Appium, UiAutomator2, Chromedriver, every test Worker and fake auth provider listen on ports the operating system assigns. `adb reverse` makes each test's Worker and fake auth provider reachable at `http://localhost:<port>` on the emulator.

Each iOS run creates its own simulator, named `cup-mobile-e2e-<random>`, in the default simulator set, because WebDriverAgent starts through `xcodebuild`, which sees no other set. The run deletes it afterwards, also when it fails. A detached watcher deletes it when the run is killed. WebDriverAgent and its MJPEG stream listen on ports the operating system assigns.

The simulator shares the Mac's loopback, and on iOS 26.3.1 it connects to `localhost` over `::1` first: a probe with servers on `127.0.0.1` and `::1` at the same port saw the app's request arrive on `::1`, and with only `127.0.0.1` listening it fell back there without a noticeable delay (2026-11-09). The fake auth provider listens on both loopbacks. Wrangler binds one address, so the test Worker listens on `127.0.0.1` alone and each iOS test relays `[::1]:<port>` to it; otherwise another process holding the same port on `::1` would receive the app's requests.

## How the app reaches the test Worker

The suite launches the installed debug build with the test Worker's origin, always `http://localhost:<port>`, as the intent extra `cupTestApiOrigin` on Android and the process arguments `-cupTestApiOrigin <origin>` on iOS; nothing is rebuilt per test. The mobile app guide describes what the [Android](../../apps/mobile-app/README.md#debug-launch-arguments) and [iOS](../../apps/mobile-app/README.md#ios-debug-launch-arguments) debug builds do with it.

## Cost and network boundary

The [test Worker's cost and network boundary](../test-worker/README.md#cost-and-network-boundary) applies to this suite. The fake auth provider stands in for Google and Supabase sign-in.

## Sign-in

The suite never signs in with real Google. Each test's fake auth provider listens at `http://localhost:<port>` on both loopback addresses and issues tokens for that origin, which the test Worker gets as its `SUPABASE_URL`; `adb reverse` makes its port reachable on the emulator. On Android, the debug build replaces the Google sign-in plugin with a [fake](../../apps/mobile-app/README.md#debug-launch-arguments) that asks the fake auth provider for an ID token, so the sign-in tests cover the Android adapter, Secure Storage and the Worker's token check, not Google. The Worker's `LOCAL_TEST_ACCOUNT_*` stay empty ([ADR 0012](../../docs/adr/0012-offer-a-local-test-account-instead-of-google-in-development.md)'s account stays out).

[`src/journeys.ts`](src/journeys.ts) holds the shared WebView journeys: `signInFromLandingPage` starts a conversion from the landing page and signs in with "Continue with Google". The web app signs out only when an account is scheduled for deletion, so the signed-out relaunch test schedules one.

One Android test launches with the real plugin (`realGoogleSignIn: true`) on the account-less emulator, taps "Continue with Google", checks that Google Play services' add-account screen is in front, presses Back and checks that Cup's landing page can start another sign-in.

## Layout

- [`src/app-device.ts`](src/app-device.ts): the device-control interface every spec uses. Platform-only steps live on the platform's class, such as [`AndroidAppDevice`](src/android/android-app-device.ts).
- [`src/fixtures.ts`](src/fixtures.ts): `useMobileApp()` opens the spec file's session and gives each test its own Worker.
- [`src/android/`](src/android/): the Android preflight check, build, emulator and global setup.
- [`src/ios/`](src/ios/): the iOS preflight check, build, simulator, WebDriverAgent build, `::1` relay and global setup.
- [`test/`](test/): specs every platform runs; platform-only specs go in `test/<platform>/`.
