# Mobile E2E tests

This package drives the debug build of the Android shell on an emulator with Appium through WebdriverIO, run by Vitest ([ADR 0018](../../docs/adr/0018-test-the-mobile-apps-with-appium-through-webdriverio-on-host-owned-emulators-and-simulators.md)). Each test launches the installed app against its own [test Worker](../test-worker/README.md) and checks what the listener sees in the WebView's DOM and which requests the Worker received. iOS joins as a second platform.

## Prerequisites

- macOS on Apple Silicon
- Android Studio with these SDK packages, installed through its SDK Manager or `sdkmanager`:
  - Android SDK Platform-Tools, Android Emulator, and Android SDK Command-line Tools (latest)
  - SDK platform 36 and the system image `system-images;android-36;google_apis;arm64-v8a`
- Java 21, with `JAVA_HOME` pointing to it. Android Studio includes one at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`.
- Internet access on the first run, for the Appium driver and Chromedriver downloads, and on every run for the Android add-account test, which opens Google's real sign-in screen through Google Play services

The suite finds the SDK at `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then Android Studio's default `~/Library/Android/sdk`. A preflight check fails the run before any device starts, naming each missing tool and how to install it.

## One-time setup

There is none to do by hand. The first run on a Mac takes several minutes longer and says so in its output:

- It installs the pinned Appium driver into the git-ignored `qa/mobile-e2e/.appium`. Later runs find it there; an interrupted installation is redone.
- It creates the suite's own emulator, `cup-mobile-e2e-api36`, in `~/Library/Caches/cup-mobile-e2e/avd`, boots it once and saves its Quick Boot snapshot. Every later run, in any checkout, boots a read-only instance from that snapshot in a few seconds. Delete the folder to rebuild the emulator, for example after a system image update.

## Run the tests

From the repository root:

```sh
pnpm run test:e2e:mobile
```

This builds the workspace, then the suite syncs the production web bundle into the Android project, builds the debug APK with Gradle, boots the emulator, starts Appium, installs the APK and runs the specs one after another. The suite runs in `pnpm validate:extended` and `pnpm validate`, after the web E2E suites.

To run one platform, name its Vitest project:

```sh
pnpm run test:e2e:mobile --project android
```

## Isolation

Runs in several checkouts can go at once. Each run boots its own emulator, which picks its own console port and reports it back, and addresses it by serial; it never kills the shared adb server or touches a device it did not start. Appium, UiAutomator2, Chromedriver, every test Worker and fake auth provider listen on ports the operating system assigns. `adb reverse` makes each test's Worker and fake auth provider reachable at `http://localhost:<port>` on the emulator.

## How the app reaches the test Worker

The suite launches the installed debug build with the intent extra `cupTestApiOrigin` set to the test Worker's origin, always `http://localhost:<port>`; nothing is rebuilt per test. The [mobile app guide](../../apps/mobile-app/README.md#debug-launch-arguments) describes what the debug build does with it.

## Cost and network boundary

The [test Worker's cost and network boundary](../test-worker/README.md#cost-and-network-boundary) applies to this suite. The fake auth provider stands in for Google and Supabase sign-in.

## Sign-in

The suite never signs in with real Google. Each test's fake auth provider listens at `http://localhost:<port>` on both loopback addresses and issues tokens for that origin, which the test Worker gets as its `SUPABASE_URL`; `adb reverse` makes its port reachable on the emulator. On Android, the debug build replaces the Google sign-in plugin with a [fake](../../apps/mobile-app/README.md#debug-launch-arguments) that asks the fake auth provider for an ID token, so the sign-in tests cover the Android adapter, Secure Storage and the Worker's token check, not Google. The Worker's `LOCAL_TEST_ACCOUNT_*` stay empty ([ADR 0012](../../docs/adr/0012-offer-a-local-test-account-instead-of-google-in-development.md)'s account stays out).

[`src/journeys.ts`](src/journeys.ts) holds the shared WebView journeys: `signInFromLandingPage` starts a conversion from the landing page and signs in with "Continue with Google". The web app signs out only when an account is scheduled for deletion, so the signed-out relaunch test schedules one.

One Android test launches with the real plugin (`realGoogleSignIn: true`) on the account-less emulator, taps "Continue with Google", checks that Google Play services' add-account screen is in front, presses Back and checks that Cup's landing page can start another sign-in.

## Share intake and the back button (Android)

[`test/android/share.test.ts`](test/android/share.test.ts) shares text to Cup the way another app's Sharesheet does: `AndroidAppDevice.share()` sends an explicit `ACTION_SEND` intent of type `text/plain` with `adb` to Cup's main activity, with the text in `android.intent.extra.TEXT` and the launch arguments as extras, so a share that starts Cup reaches the test Worker too. No real Sharesheet is driven. Signed in, a share fills the Add dialog's URL field whether Cup was force-stopped or running, a second share replaces the first, `&`, `+` and a `#fragment` arrive unchanged, and a URL is picked out of surrounding text; text without a URL and a `cup.audio` link are ignored, which passes when Cup stays on Recents with no form open for a few seconds. Signed out, a share fills the landing page's start form. Every share test checks that the Worker received no request starting a conversion after the share.

[`test/android/back-button.test.ts`](test/android/back-button.test.ts) relaunches a signed-in Cup so Recents is the first screen. Back closes the Add dialog and leaves a track's page for Recents; on Recents, Back puts Cup in the background with its page kept, which the test checks by bringing Cup back to the foreground. The Add dialog focuses its URL field, which opens the on-screen keyboard, and Android's first Back closes an open keyboard instead of reaching Cup, so the test leaves the field and waits for the keyboard to close before pressing Back.

## Layout

- [`src/app-device.ts`](src/app-device.ts): the device-control interface every spec uses. Platform-only steps live on the platform's class, such as [`AndroidAppDevice`](src/android/android-app-device.ts).
- [`src/fixtures.ts`](src/fixtures.ts): `useMobileApp()` opens the spec file's session and gives each test its own Worker.
- [`src/android/`](src/android/): the Android preflight check, build, emulator and global setup.
- [`test/`](test/): specs every platform runs; platform-only specs go in `test/<platform>/`.
