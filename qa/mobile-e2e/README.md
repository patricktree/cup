# Mobile E2E tests

This package drives the debug build of the Android shell on an emulator and of the iOS shell on a simulator with Appium through WebdriverIO, run by Vitest ([ADR 0018](../../docs/adr/0018-test-the-mobile-apps-with-appium-through-webdriverio-on-host-owned-emulators-and-simulators.md)). Each test launches the installed app against its own [test Worker](../test-worker/README.md) and checks what the listener sees in the WebView's DOM and which requests the Worker received.

## Prerequisites

- macOS on Apple Silicon
- Android Studio with these SDK packages, installed through its SDK Manager or `sdkmanager`:
  - Android SDK Platform-Tools, Android Emulator, and Android SDK Command-line Tools (latest)
  - SDK platform 36 and the system image `system-images;android-36;google_apis;arm64-v8a`
- Java 21, with `JAVA_HOME` pointing to it. Android Studio includes one at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`.
- Xcode that supports the host macOS, with the iOS simulator runtime of the same version as Xcode's simulator SDK, such as iOS 27.2 for Xcode 27.2: install it with `xcodebuild -downloadPlatform iOS` or in Xcode under Settings > Components. The suite uses that runtime even when newer ones are installed. With the older iOS 26.3.1 runtime on macOS 27.2, WebKit's content process crashed in about one launch in seven and left Cup's WebView blank (2026-11-09); 15 consecutive runs on iOS 27.2 passed. Since version 26, Xcode's major version must be at least macOS's: an older Xcode hangs every XCTest runner, WebDriverAgent included. After an Xcode update, restart CoreSimulatorService with `killall -9 com.apple.CoreSimulator.CoreSimulatorService`.
- Internet access on the first run, for the Appium driver and Chromedriver downloads, and on every run for the Android add-account test, which opens Google's real sign-in screen through Google Play services

The suite finds the SDK at `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then Android Studio's default `~/Library/Android/sdk`. A preflight check per platform fails the run before any device starts, naming each missing tool and how to install it, and the Xcode update or CoreSimulatorService restart the iOS run needs.

## One-time setup

There is none to do by hand. The first run on a Mac takes several minutes longer and says so in its output:

- It installs the pinned Appium drivers into the git-ignored `qa/mobile-e2e/.appium`. Later runs find it there; an interrupted installation is redone.
- It creates the suite's own emulator, `cup-mobile-e2e-api36-ram4g` with 4 GB of RAM, in `~/Library/Caches/cup-mobile-e2e/avd`, boots it once and saves its Quick Boot snapshot. The Pixel 8 profile's default 2 GB made the guest swap constantly during the full suite until adbd stopped answering. A Mac that still has the earlier 2 GB `cup-mobile-e2e-api36` creates the new emulator and its snapshot on its next run; the old folder is no longer used and can be deleted. Every later run, in any checkout, boots a read-only instance from that snapshot in a few seconds. Delete the folder to rebuild the emulator, for example after a system image update.
- It builds the XCUITest driver's WebDriverAgent for the simulator into `~/Library/Caches/cup-mobile-e2e/wda`, in a folder named after the WebDriverAgent version and Xcode's build version. Every later run, in any checkout, starts that build with `xcodebuild test-without-building` and never rebuilds it; a new driver or Xcode version builds a new folder.

## Run the tests

From the repository root:

```sh
pnpm run test:e2e:mobile
```

This builds the workspace, then each platform syncs the production web bundle into its native project, builds the debug app (the APK with Gradle, the simulator app with `xcodebuild`), starts its device and Appium, installs the app and runs the specs one after another. The suite runs in the [deploy gate](../../tooling/validation-gates/README.md), after the web E2E suites.

To run one platform, name its Vitest project:

```sh
pnpm run test:e2e:mobile --project android
pnpm run test:e2e:mobile --project ios
```

## Runtime

The suite's budget is about 10 minutes for both platforms on a warm Mac, one with the drivers installed, WebDriverAgent built and the emulator's snapshot saved. Measured on 2026-11-10 on an Apple Silicon Mac with Xcode 27.2 and the iOS 27.2 runtime, one platform at a time, with the workspace build cached:

| Run                              | Android (16 tests) | iOS (10 tests) | Both       |
| -------------------------------- | ------------------ | -------------- | ---------- |
| Warm                             | 1 min 59 s         | 2 min 51 s     | 4 min 50 s |
| New checkout, drivers to install | 2 min 18 s         | 3 min 10 s     | 5 min 28 s |

Vitest reported 116 s for Android and 166 s for iOS, of which the tests took 112 s and 142 s, and 303 s for both platforms in one `pnpm run test:e2e:mobile` within a full validation run; the rest is the cached workspace and app builds, the preflight check, and starting the device and Appium. The iOS share tests through Safari's Share Sheet take 12 to 20 seconds each. A Mac's first run, which also creates the emulator's snapshot and builds WebDriverAgent, takes several minutes longer.

Later on 2026-11-10, after iOS gained its signed-in tests ([CUP-60](https://linear.app/cup-audio/issue/CUP-60)), three consecutive warm iOS runs of 18 tests took 4 min 40 s to 4 min 46 s, while other checkouts loaded the Mac; Vitest reported 276 to 282 s, of which the tests took 253 to 255 s. With Android unchanged, both platforms take about 7 minutes warm, within the budget; Android was not measured again.

## Debug a test

When a test fails, the suite keeps what the device and the test Worker showed at that moment in the git-ignored `qa/mobile-e2e/test-output/<platform>/<spec>/<test>/` and prints the folder's path:

- `screenshot.png`: the device's screen
- `native-page-source.xml`: the native view hierarchy, which includes system screens such as Google's add-account screen
- `webview-dom.html`: the DOM of the WebView the test was in, or of Cup's WebView when the test was in the native context
- `device.log`: the device log since the test started. On Android it is a one-off `adb -s <serial> logcat -d` dump of the run's emulator; Appium's own logcat capture stays off (see [Finding Cup's WebView](#finding-cups-webview-android)). On iOS it is the run's simulator's `log show --last <n>m`, in whole minutes since the test started, limited to the processes a test involves: Cup, its share extension, WebKit's processes and Safari. Unfiltered, a new simulator logged 86 MB of system daemons in one minute.
- `worker.log`: the test Worker's Wrangler output, including each request it received

An artifact the suite could not capture, such as the WebView's DOM when Cup shows no page, is written as `<file>.missing.txt` with the reason. Each capture gets 20 seconds; once the Appium session leaves one unanswered, the suite skips the remaining captures through it. Passing tests leave nothing behind, and each platform's run first removes the folder its previous run left.

To keep a failed test's Worker persistence directory for inspection, run:

```sh
E2E_RETAIN_STATE=1 pnpm run test:e2e:mobile
```

The test's folder then holds `worker-persistence-directory.txt` with the retained directory's path.

To stream each test Worker's Wrangler logs to the terminal while a test runs, add `E2E_STREAM_WRANGLER=1`. Both flags are the [web suite's](../e2e/README.md#debug-a-test), so one setting applies to a whole validation gate run.

## Isolation

Runs in several checkouts can go at once. Each run boots its own emulator, which picks its own console port and reports it back, and addresses it by serial; it never kills the shared adb server or touches another run's device while that run still runs. Appium, UiAutomator2, Chromedriver, every test Worker and fake auth provider listen on ports the operating system assigns. `adb reverse` makes each test's Worker and fake auth provider reachable at `http://localhost:<port>` on the emulator. The emulator's own sockets use ports from the same range the Mac assigns from: a minute after booting from the snapshot it held about 60 on such ports, Google Play services' connections and sockets in TIME_WAIT, and `adb reverse` fails with "Address already in use" for any of them (2026-11-10). When the device side of a port is taken, the test starts that server again on another port the operating system assigns, up to five times.

Each iOS run creates its own simulator, named after the run (see [Leftover devices](#leftover-devices)), in the default simulator set, because WebDriverAgent starts through `xcodebuild`, which sees no other set. Because the simulator is the run's own, `IosAppDevice.clearAppData()` resets its whole Keychain along with reinstalling Cup: Cup keeps the account session in the Keychain, which a reinstall leaves in place. The run deletes it afterwards, also when it fails. A detached watcher deletes it when the run is killed. WebDriverAgent and its MJPEG stream listen on ports the operating system assigns.

### Leftover devices

A run that is killed outright, such as with `kill -9` on its process group, can leave its device behind: the emulator keeps running after its parent exits, and the kill can take the simulator's watcher with it. So each platform's setup first removes devices that earlier runs left behind:

- Android: emulators of the suite's AVD whose run has exited, which macOS shows as processes whose parent is `launchd` (process ID 1). They get SIGTERM, then SIGKILL after 15 seconds.
- iOS: simulators whose name records a run that no longer runs. The name is `cup-mobile-e2e-<process ID>-<start time>-<random>`, with the run's process ID and its start time to the second as `ps -o lstart` reports it, written `YYYYMMDDhhmmss`, because macOS reuses process IDs; a run counts as gone unless `ps` lists its process ID with exactly that start time. Simulators named `cup-mobile-e2e-<random>`, by checkouts from before the name recorded its run, are never deleted, since their run may still go; delete them by hand with `xcrun simctl delete <udid>` once no run of such a checkout is going.

To remove leftover devices without starting a run:

```sh
pnpm run test:e2e:mobile:clean
```

The simulator shares the Mac's loopback, and on iOS 26.3.1 it connects to `localhost` over `::1` first: a probe with servers on `127.0.0.1` and `::1` at the same port saw the app's request arrive on `::1`, and with only `127.0.0.1` listening it fell back there without a noticeable delay (2026-11-09). The fake auth provider listens on both loopbacks. Wrangler binds one address, so the test Worker listens on `127.0.0.1` alone and each iOS test relays `[::1]:<port>` to it; otherwise another process holding the same port on `::1` would receive the app's requests. When another process holds it, the test starts that server again on another port, as on Android.

## Finding Cup's WebView (Android)

The Appium session sets `ensureWebviewsHavePages` and `enableWebviewDetailsCollection` to `false`, so listing contexts reads the devtools sockets from `/proc/net/unix` and never connects to them. With the defaults, every listing sent an HTTP request through `adb forward` to the devtools socket of each app's WebView. Android's cached-apps freezer freezes background apps such as the Google app, which then never accept those connections. Once a frozen app's listen backlog was full, adbd blocked connecting to it and every later adb call on the emulator hung: a probe reproduced this after about a dozen requests to Cup's own socket while Cup was frozen (2026-11-09). In the full suite, Appium's requests to a frozen WebView of the Google app timed out, and the hang then failed the following specs, which waited 60 seconds for Cup's WebView.

## Relaunching Cup (Android)

`AndroidAppDevice.leaveAndTerminate()` sends Cup to the background and waits until Android reports its activity stopped before it force-stops Cup. `relaunch()` uses it before starting Cup again, and so does the share test that signs in and then shares to a stopped Cup; the plain `terminate()` force-stops at once and serves the teardown only. Secure Storage writes the account session to SharedPreferences with `apply()`, which reaches the disk after the sign-in or sign-out has finished, and Android completes such writes before it reports an activity stopped. A force-stop of Cup in the foreground right after signing in lost the session in 5 of 15 relaunches in a probe (2026-11-10), and the relaunched Cup opened the landing page instead of Recents.

## How the app reaches the test Worker

The suite launches the installed debug build with the test Worker's origin, always `http://localhost:<port>`, as the intent extra `cupTestApiOrigin` on Android and the process arguments `-cupTestApiOrigin <origin>` on iOS; nothing is rebuilt per test. On iOS, a URL that starts Cup passes no launch arguments, so before such a launch `IosAppDevice.storeApiOrigin()` writes the origin into Cup's defaults with `xcrun simctl spawn <udid> defaults write audio.cup.app cupTestApiOrigin <origin>`; the reinstall before each test erases it. The mobile app guide describes what the [Android](../../apps/mobile-app/README.md#debug-launch-arguments) and [iOS](../../apps/mobile-app/README.md#ios-debug-launch-arguments) debug builds do with it.

## Cost and network boundary

The [test Worker's cost and network boundary](../test-worker/README.md#cost-and-network-boundary) applies to this suite. The fake auth provider stands in for Google and Supabase sign-in.

## Sign-in

The suite never signs in with real Google. Each test's fake auth provider listens at `http://localhost:<port>` on both loopback addresses and issues tokens for that origin, which the test Worker gets as its `SUPABASE_URL`; `adb reverse` makes its port reachable on the emulator. On Android, the debug build replaces the Google sign-in plugin with a [fake](../../apps/mobile-app/README.md#debug-launch-arguments) that asks the fake auth provider for an ID token, so the sign-in tests cover the Android adapter, Secure Storage and the Worker's token check, not Google. On iOS, the debug build signs in as a release build does, through the `WebAuthentication` plugin's `ASWebAuthenticationSession` ([ADR 0019](../../docs/adr/0019-sign-in-on-ios-through-supabase-oauth-in-a-system-browser-sheet.md)): the fake auth provider's authorize endpoint redirects straight to `audio.cup.app://auth/callback` with a code, so the sheet closes without showing a page, and the app exchanges the code with its PKCE verifier. Before the sheet opens, iOS asks whether Cup may use `localhost` to sign in; `IosAppDevice.continueGoogleSignIn()` taps Continue. The iOS sign-in tests cover the iOS adapter, the plugin, the sheet, Secure Storage and the Worker's token check, not Google's page. The Worker's `LOCAL_TEST_ACCOUNT_*` stay empty ([ADR 0012](../../docs/adr/0012-offer-a-local-test-account-instead-of-google-in-development.md)'s account stays out).

[`src/journeys.ts`](src/journeys.ts) holds the shared WebView journeys: `signInFromLandingPage` starts a conversion from the landing page, signs in with "Continue with Google" and takes the platform's steps after it through `AppDevice.continueGoogleSignIn()`, none on Android. [`test/sign-in.test.ts`](test/sign-in.test.ts) runs on both platforms. The web app signs out only when an account is scheduled for deletion, so the signed-out relaunch test schedules one, which signs in afresh first: on iOS through the sheet and its prompt again.

One Android test launches with the real plugin (`realGoogleSignIn: true`) on the account-less emulator, taps "Continue with Google", waits until Google Play services' add-account screen is in front and has rendered Google's sign-in page, presses Back and checks that Cup's landing page can start another sign-in. The test asserts that Google Play services' package (`com.google.android.gms`) is in front; it waits for the add-account activity only so that Back reaches that screen rather than the sign-in trampoline beneath it. Across the cancel, Cup kept its state on the 2026-11-09 and 2026-11-10 runs: the same page, the filled start form and the open sign-in dialog, which the test then checks shows no error. Should the WebView restart instead, the test starts the sign-in again from the start form.

## Share intake and the back button (Android)

[`test/android/share.test.ts`](test/android/share.test.ts) shares text to Cup the way another app's Sharesheet does: `AndroidAppDevice.share()` sends an explicit `ACTION_SEND` intent of type `text/plain` with `adb` to Cup's main activity, with the text in `android.intent.extra.TEXT` and the launch arguments as extras, so a share that starts Cup reaches the test Worker too. No real Sharesheet is driven. Signed in, a share fills the Add dialog's URL field whether Cup was stopped or running, a second share replaces the first, `&`, `+` and a `#fragment` arrive unchanged, and a URL is picked out of surrounding text; text without a URL and a `cup.audio` link are ignored, which passes when Cup stays on Recents with no form open for a few seconds. Signed out, a share fills the landing page's start form. Every share test checks that the Worker received no request starting a conversion after the share.

## Share intake (iOS)

[`test/ios/share.test.ts`](test/ios/share.test.ts) opens `audio.cup.app://share?url=…` links in Cup with Appium's `mobile: deepLink`, as the Share Extension hands a share to Cup; neither Safari nor the extension takes part. `IosAppDevice.openUrl()` sends the link to a running Cup, or starts Cup when it is not running. A link that starts Cup carries no launch arguments, so those cases first store the test Worker's origin with `IosAppDevice.storeApiOrigin()`. Signed in, a share fills the Add dialog's URL field whether it starts Cup or reaches a running one. Signed out, on the landing page, a share fills the start form whether it starts Cup or reaches a running one, and a share that starts Cup reached the test Worker; a second share replaces the first; and a `cup.audio` link, also one that starts Cup, and a share link without a `url` or with one that is no HTTP(S) URL are ignored, which passes when the landing page stays with an empty start form for a few seconds. The Android and iOS share specs use the same assertions from [`src/share-assertions.ts`](src/share-assertions.ts): the form's URL field equals the shared URL exactly, an ignored share leaves Cup on its screen with no form filled, and the Worker received no request starting a conversion.

## Sharing from Safari (iOS)

[`test/ios/share-sheet.test.ts`](test/ios/share-sheet.test.ts) shares a page through Safari's real Share Sheet and the `CupShare` extension, which catches an iOS update that breaks the extension's handoff to Cup. `IosAppDevice.shareFromSafari()` opens the page in Safari, taps More, Share, **Cup** in the Share Sheet's app row, then **Open in Cup** or **Cancel** in the extension's sheet. The page comes from a server the test starts on `127.0.0.1`, so Safari needs no internet. Signed out, a share fills the landing page's start form with the URL exactly, both when it starts Cup, with `&`, `+` and a `#fragment` in the URL, and when Cup already runs, and the Worker received no request starting a conversion. After a cancelled share, Safari stays in front and Cup does not start for a few seconds.

**These tests depend on Safari's system UI** and its element labels and types, which Apple changes without notice. They are expected to fail when an iOS or Xcode update changes that UI: update the selectors in `IosAppDevice` rather than retrying the tests.

[`test/android/back-button.test.ts`](test/android/back-button.test.ts) relaunches a signed-in Cup so Recents is the first screen. Back closes the Add dialog and leaves a track's page for Recents; on Recents, Back puts Cup in the background with its page kept, which the test checks by bringing Cup back to the foreground. The Add dialog focuses its URL field, which opens the on-screen keyboard, and Android's first Back closes an open keyboard instead of reaching Cup, so the test waits for the keyboard to show, leaves the field and waits until the keyboard has left the screen before pressing Back. The keyboard can show seconds after the field got focus, the first time after the emulator booted, and then closes only after the field was left; a Back press in between closed the keyboard.

## Native networking

[`test/native-networking.test.ts`](test/native-networking.test.ts), on both platforms, signs in, submits the Add dialog with the source URL the test Worker's fake source preparation accepts, and waits for Recents to list the new conversion. From the Worker's request log it checks that the conversion's `POST /api/account/conversions` arrived without an Origin header but with the `X-Create-Audiobook-From-URL-Request` header and the JSON content type, as only `CapacitorHttp`'s native requests send it, and that every account request since carried a bearer token the test's fake auth provider signed.

## Layout

- [`src/app-device.ts`](src/app-device.ts): the device-control interface every spec uses. Platform-only steps live on the platform's class, such as [`AndroidAppDevice`](src/android/android-app-device.ts).
- [`src/fixtures.ts`](src/fixtures.ts): `useMobileApp()` opens the spec file's session, gives each test its own Worker and keeps a failed test's artifacts.
- [`src/failure-artifacts.ts`](src/failure-artifacts.ts): the output folder and the artifacts captured through the Appium session.
- [`src/journeys.ts`](src/journeys.ts) and [`src/share-assertions.ts`](src/share-assertions.ts): WebView journeys and share assertions that specs of several platforms share.
- [`src/run-owner.ts`](src/run-owner.ts) and [`src/clean-devices.ts`](src/clean-devices.ts): which run a device belongs to, and the sweep of [leftover devices](#leftover-devices).
- [`src/android/`](src/android/): the Android preflight check, build, emulator and global setup.
- [`src/ios/`](src/ios/): the iOS preflight check, build, simulator, WebDriverAgent build, `::1` relay, the page Safari shares and global setup.
- [`test/`](test/): specs every platform runs; platform-only specs go in `test/<platform>/`.
- [`test-unit/`](test-unit/): unit tests of the suite's own helpers, which need no device: `pnpm --filter @cup/mobile-e2e test`.
