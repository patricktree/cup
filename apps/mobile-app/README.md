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

## iOS

After building, open `apps/mobile-app/ios/App/App.xcodeproj` in Xcode and choose a simulator or configure signing for a device. The project uses Swift Package Manager, matching Content Relay.

## Links and sharing

Neither app claims web links, so tapping a link to `cup.audio`, such as a trial link, opens the browser. The Android app accepts shared plain text containing an HTTP or HTTPS URL and fills a conversion form without submitting it. A signed-in account gets the Add dialog over Recents (`/recent/add`). Signed out, the app reopens the last trial whose credential was successfully exchanged in the app; if no trial is remembered, the shared URL waits until a conversion form is opened.

## Backend access and grant sessions

Mobile API requests use ordinary `fetch` calls patched by `CapacitorHttp` to use native networking. The backend origin is `https://cup.audio`. Browser requests continue using the browser's same-origin fetch.

Both clients exchange trial credentials for persistent Secure, HttpOnly cookies. Capacitor's native cookie manager stores the server-issued cookies and sends them on later requests. Trial requests use those cookies; private account requests additionally carry the signed-in user's bearer token. The `CapacitorCookies` document.cookie patch (<https://capacitorjs.com/docs/apis/cookies>) is not enabled.

Native mutations omit Origin and must include the existing custom request header and JSON content type. Browser mutations must have a matching Origin; cross-site Fetch Metadata is rejected. No cross-origin browser CORS access is enabled.

Capacitor's native HTTP response headers can expose Set-Cookie to JavaScript, so HttpOnly does not provide the same isolation as browser networking.

## iOS Share Extension

The iOS app bundles `CupShare.appex`, displayed as **Cup** in Safari and Chrome's Share Sheets. Share a web URL or text containing an HTTP(S) URL, then tap **Open in Cup** to open the main app and prefill the conversion form. A shared trial link opens its trial in the app instead, including the credential exchange.

The handoff uses `audio.cup.app://share?url=<encoded-url>`, the app's only URL scheme. Links under `https://cup.audio/app` open their corresponding app route, preserving trial credential fragments; other HTTP(S) URLs prefill a conversion form as on [Android](#links-and-sharing); a URL still pending in memory is discarded when the app closes.

The extension uses the same responder-chain URL-opening approach as Chromium, calling `openURL:options:completionHandler:` dynamically. Apple does not support this handoff from Share Extensions; test it after iOS updates. A failed handoff stays in the extension with an error and retry button. The extension does not start conversions or access session cookies.

Build the App scheme with a local `DEVELOPMENT_TEAM` override; it builds, signs, and embeds the extension. Both bundle identifiers need provisioning: `audio.cup.app` and `audio.cup.app.share`. Verify Safari and Chrome sharing with Cup terminated and already running, cancellation, repeated shares, URLs containing `&`, `+`, or fragments, and trial links. If Cup is hidden, look under More in the Share Sheet's app row.

## Brand assets

Edit the canonical artwork in `tooling/brand-assets/assets/` at the repository root. Run `pnpm brand-assets:sync` to regenerate native icons, splash images, and web assets, then review the generated changes. Native sync uses the checked-in brand assets without regenerating them. See [the brand asset guide](../../tooling/brand-assets/README.md) for sources, sizing, and validation.

## Playback

The shells have no native audio player; see [playback](../../docs/architecture/conversion.md#playback). Nothing detects or gates WebView playback until [#55](https://github.com/patricktree/cup/issues/55).
