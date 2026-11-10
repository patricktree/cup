# Mobile app

Capacitor shells for Android and iOS, based on Content Relay's `apps/mobile-app`. Both package Cup from the shared web app in `apps/web-app/dist/web`. Both use the identifier `audio.cup.app`; the iOS Share Extension uses `audio.cup.app.share`.

## Build

From the repository root:

```sh
pnpm --filter '@cup/mobile-app' build
```

This runs the cached shared web build and Capacitor configuration check, then syncs web assets into both native projects. Sync runs outside Turbo and always executes, even when both build tasks hit the cache.

The repository-wide `pnpm build` and `pnpm validate` run `turbo:build` without syncing native projects. Use the mobile package's `build` command above before building or installing a native app.

To sync an already built web bundle:

```sh
pnpm --filter '@cup/mobile-app' native:sync
```

## Android locally

Install Android Studio with SDK platform 36 and Java 21. Set `JAVA_HOME` to a Java 21 installation; Android Studio on macOS includes one at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`.

Create the ignored file `apps/mobile-app/android/local.properties` with your SDK path:

```properties
sdk.dir=/Users/your-user/Library/Android/sdk
```

Start an Android emulator in Android Studio, or connect a device with USB debugging enabled. Confirm it appears in `adb devices`. Build the web bundle with the command above, then run:

```sh
cd apps/mobile-app/android
./gradlew assembleDebug testDebugUnitTest lintDebug installDebug
adb shell am start -n audio.cup.app/.MainActivity
```

The debug APK is written to `apps/mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`. Confirm the landing page renders and the app can close and reopen without a crash.

The [mobile E2E tests](../../qa/mobile-e2e/README.md) launch the debug build on their own emulator against a local test Worker and check that it launches to the landing page, signs in, keeps or ends the session across a relaunch, handles a cancelled Google sign-in, fills a conversion form from a shared URL, and handles the back button. Cup's presence in the Android Sharesheet when sharing from another app stays a manual check: the tests send the share intent directly. On iOS, the tests open `audio.cup.app://share` links in a signed-out Cup and leave the Share Extension and its handoff to the manual checks below.

### Debug launch arguments

The debug build reads the backend origin from the intent extra `cupTestApiOrigin`, which the mobile E2E suite sets to its test Worker:

```sh
adb shell am start -n audio.cup.app/.MainActivity --es cupTestApiOrigin http://localhost:8787
```

The value must be exactly `http://localhost:<port>`; any other value stops the app at launch with an `IllegalArgumentException` naming the argument, so a broken test setup never reaches production. Without the extra, a debug build uses `https://cup.audio` as before. Use `adb reverse tcp:<port> tcp:<port>` to make a port on your Mac reachable at `localhost` on the device.

Only the debug source set (`android/app/src/debug`) handles the argument: before Capacitor loads the page, it sets the global `window.cupTestApiOrigin` that the web app's `apiOrigin()` reads, and lets the `https://localhost` page load `http://localhost` media. The same source set allows plain HTTP to `localhost` and nowhere else. The argument needs Android 10 (API 29) or later, where activity pre-creation callbacks exist. Release builds contain none of this.

With the test origin, the debug build also replaces the native Google sign-in plugin with a fake of the same name (`FakeGoogleSignInPlugin`, debug sources only). Its `signIn` asks the test Worker's fake auth provider, found as the `supabaseUrl` of the Worker's auth configuration, for an ID token carrying the hashed nonce it was given, so the web app's unchanged sign-in, Secure Storage and the Worker's token check run without Google. A debug build launched without the test origin keeps the real plugin and signs in with real Google.

The second launch argument, the boolean extra `cupTestRealGoogleSignIn`, keeps the real plugin under the test origin, so a test can open Google's real add-account screen:

```sh
adb shell am start -n audio.cup.app/.MainActivity --es cupTestApiOrigin http://localhost:8787 --ez cupTestRealGoogleSignIn true
```

It has no effect without `cupTestApiOrigin`.

## iOS

After building, open `apps/mobile-app/ios/App/App.xcodeproj` in Xcode and choose a simulator or configure signing for a device. The project uses Swift Package Manager, matching Content Relay.

The [mobile E2E tests](../../qa/mobile-e2e/README.md) launch the debug build on their own simulator against a local test Worker and check that it launches to the landing page.

### iOS debug launch arguments

The debug build reads the backend origin from the process arguments `-cupTestApiOrigin <origin>`, which the mobile E2E suite sets to its test Worker:

```sh
xcrun simctl launch <simulator> audio.cup.app -cupTestApiOrigin http://localhost:8787
```

In Xcode, add the arguments under the App scheme's Run action, Arguments Passed On Launch. As on [Android](#debug-launch-arguments), the value must be exactly `http://localhost:<port>`; any other value stops the app at launch with a fatal error naming the argument, and without the arguments a debug build uses `https://cup.audio`. The simulator shares the Mac's loopback, so `localhost` needs no port forwarding.

Only `#if DEBUG` code in [`MainViewController.swift`](ios/App/App/MainViewController.swift) handles the arguments: before Capacitor loads the page, it adds a document-start script that sets the global `window.cupTestApiOrigin`. App Transport Security's built-in exemption for `localhost` allows the plain HTTP, so `Info.plist` is unchanged. Release builds contain none of this.

## Links and sharing

The apps intentionally don't support trial links ([ADR 0017](../../docs/adr/0017-keep-trial-links-out-of-the-mobile-apps.md)). Neither app claims web links, so tapping a link to `cup.audio`, such as a trial link, opens the browser, and share intake ignores URLs on Cup's hostnames.

The Android app accepts shared plain text containing an HTTP or HTTPS URL and fills a conversion form without submitting it. A signed-in account gets the Add dialog over Recents (`/recent/add`). Signed out, the URL fills the landing page's start form, which asks the listener to sign in when submitted.

## Backend access and grant sessions

Mobile API requests use ordinary `fetch` calls patched by `CapacitorHttp` to use native networking. The backend origin is `https://cup.audio`, except in a debug build launched with a [test origin](#debug-launch-arguments). Browser requests continue using the browser's same-origin fetch.

The browser exchanges trial credentials for persistent Secure, HttpOnly cookies. The apps open no trials ([ADR 0017](../../docs/adr/0017-keep-trial-links-out-of-the-mobile-apps.md)), so their private account requests rely on the signed-in user's bearer token; Capacitor's native cookie manager still stores any server-issued cookies and sends them on later requests. The `CapacitorCookies` document.cookie patch (<https://capacitorjs.com/docs/apis/cookies>) is not enabled.

Native mutations omit Origin and must include the existing custom request header and JSON content type. Browser mutations must have a matching Origin; cross-site Fetch Metadata is rejected. No cross-origin browser CORS access is enabled.

Capacitor's native HTTP response headers can expose Set-Cookie to JavaScript, so HttpOnly does not provide the same isolation as browser networking.

## iOS Share Extension

The iOS app bundles `CupShare.appex`, displayed as **Cup** in Safari and Chrome's Share Sheets. Share a web URL or text containing an HTTP(S) URL, then tap **Open in Cup** to open the main app and prefill the conversion form.

The handoff uses `audio.cup.app://share?url=<encoded-url>`, the app's only URL scheme. The URL prefills a conversion form as on [Android](#links-and-sharing), and Cup links are ignored there too; a URL still pending in memory is discarded when the app closes.

The app uses the UIScene lifecycle, which iOS 27 requires: an app built with the iOS 27 SDK that keeps the app-delegate lifecycle stops at launch. [`SceneDelegate`](ios/App/App/SceneDelegate.swift) receives incoming URLs, both at a cold start and while Cup runs, and hands them to Capacitor's `SceneDelegateProxy`, which passes them on to the App plugin's `appUrlOpen` event and launch URL.

The extension uses the same responder-chain URL-opening approach as Chromium, calling `openURL:options:completionHandler:` dynamically. Apple does not support this handoff from Share Extensions; test it after iOS updates. A failed handoff stays in the extension with an error and retry button. The extension does not start conversions or access session cookies.

The [mobile E2E tests](../../qa/mobile-e2e/README.md#share-intake-ios) cover what the app does with a share link once it arrives, signed out only.

Build the App scheme with a local `DEVELOPMENT_TEAM` override; it builds, signs, and embeds the extension. Both bundle identifiers need provisioning: `audio.cup.app` and `audio.cup.app.share`. Verify Safari and Chrome sharing with Cup terminated and already running, cancellation, repeated shares, URLs containing `&`, `+`, or fragments, and that a shared trial link is ignored. If Cup is hidden, look under More in the Share Sheet's app row.

## Brand assets

Edit the canonical artwork in `tooling/brand-assets/assets/` at the repository root. Run `pnpm brand-assets:sync` to regenerate native icons, splash images, and web assets, then review the generated changes. Native sync uses the checked-in brand assets without regenerating them. See [the brand asset guide](../../tooling/brand-assets/README.md) for sources, sizing, and validation.

## Playback

The shells have no native audio player; see [playback](../../docs/architecture/conversion.md#playback). Nothing detects or gates WebView playback until [#55](https://github.com/patricktree/cup/issues/55).
