# Mobile app

Capacitor shells for Android and iOS, based on Content Relay's `apps/mobile-app`. Both package Cup from the shared web app in `apps/web-app/dist/web`. Android uses `com.cup_audio.app`; iOS uses `com.cup-audio.app` with the extension `com.cup-audio.app.share`.

## Build

From the repository root:

```sh
pnpm --filter '@cup/mobile-app' build
```

The sync command selects the platform-specific Capacitor ID through `CUP_NATIVE_PLATFORM`. Use `CUP_NATIVE_PLATFORM=android` with direct Android Capacitor commands.

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
adb shell am start -n com.cup_audio.app/.MainActivity
```

The debug APK is written to `apps/mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`. Confirm the landing page renders and the app can close and reopen without a crash.

## iOS

After building, open `apps/mobile-app/ios/App/App.xcodeproj` in Xcode and choose a simulator or configure signing for a device. The project uses Swift Package Manager, matching Content Relay.

## Android App Links and sharing

The Android app accepts shared plain text containing an HTTP or HTTPS URL and fills the conversion form without submitting it. It reopens the last trial whose credential was successfully exchanged in the app. If no trial is remembered, the shared URL waits until a conversion form is opened.

HTTPS links to `/app` and `/app/…` on `cup-audio.com` open the matching route in the app after Android verifies the domain association. API and download URLs are excluded from App Links. Paths, query parameters, and fragments are preserved, including trial credentials. Both cold starts and links delivered to an already running app are handled. Normal Capacitor launches start at `/app/`.

Deploy the web app so `https://cup-audio.com/.well-known/assetlinks.json` serves the file from `apps/web-app/public/.well-known/assetlinks.json` as JSON, without redirects. That file trusts Patrick's local Android debug certificate. A release or Play Store build requires its signing certificate's SHA-256 fingerprint to be added before deployment; another machine's debug certificate will also differ.

After deploying the association file and installing the rebuilt APK, request verification and inspect the result:

```sh
adb shell pm verify-app-links --re-verify com.cup_audio.app
adb shell pm get-app-links com.cup_audio.app
```

Verification is asynchronous. Wait until the domain reports `verified`, then open a link without specifying the app package, so Android exercises domain resolution:

```sh
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://cup-audio.com/app/'
```

See [Android's App Links verification guide](https://developer.android.com/training/app-links/verify-applinks) for device settings and troubleshooting.

## Backend access and grant sessions

Mobile API requests use ordinary `fetch` calls patched by `CapacitorHttp` to use native networking. The backend origin is `https://cup-audio.com`. Browser requests continue using the browser's same-origin fetch.

Both clients exchange trial credentials for persistent Secure, HttpOnly cookies. Capacitor's native cookie manager stores the server-issued cookies and sends them on later requests. Trial requests use those cookies; private account requests additionally carry the signed-in user's bearer token. The `CapacitorCookies` document.cookie patch (<https://capacitorjs.com/docs/apis/cookies>) is not enabled.

Native mutations omit Origin and must include the existing custom request header and JSON content type. Browser mutations must have a matching Origin; cross-site Fetch Metadata is rejected. No cross-origin browser CORS access is enabled.

Capacitor's native HTTP response headers can expose Set-Cookie to JavaScript, so HttpOnly does not provide the same isolation as browser networking.

## iOS Share Extension

The iOS app bundles `CupShare.appex`, displayed as **Cup** in Safari and Chrome's Share Sheets. Share a web URL or text containing an HTTP(S) URL, then tap **Open in Cup** to open the main app and prefill the conversion form. Cup trial links open their app route, including the credential exchange.

The handoff uses `cup-audio://share?url=<encoded-url>`. Cup links under `https://cup-audio.com/app` open their corresponding app route, preserving trial credential fragments. Other HTTP(S) URLs prefill the conversion form for the last authorized trial without submitting it. If no trial has been authorized, the URL remains pending in memory until a form opens; closing the app discards it.

The extension uses the same responder-chain URL-opening approach as Chromium, calling `openURL:options:completionHandler:` dynamically. Apple does not support this handoff from Share Extensions; test it after iOS updates. A failed handoff stays in the extension with an error and retry button. The extension does not start conversions or access session cookies.

Build the App scheme with a local `DEVELOPMENT_TEAM` override; it builds, signs, and embeds the extension. Both bundle identifiers need provisioning: `com.cup-audio.app` and `com.cup-audio.app.share`. Verify Safari and Chrome sharing with Cup terminated and already running, cancellation, repeated shares, URLs containing `&`, `+`, or fragments, and trial links. If Cup is hidden, look under More in the Share Sheet's app row.

## iOS Universal Links

The App target includes the Associated Domains entitlement for `applinks:cup-audio.com`. HTTPS links to `/app` and `/app/…` navigate to the corresponding app route on cold and warm launches, preserving query parameters and trial credential fragments. Other domains, credentials in the URL authority, and routes outside `/app` are rejected by the iOS intake handler.

Deploy `apps/web-app/public/.well-known/apple-app-site-association` together with `apps/web-app/public/_headers` so `https://cup-audio.com/.well-known/apple-app-site-association` returns JSON with status 200 and no redirect. The association uses Cup's new bundle ID with Patrick's current Personal Team prefix; it must be updated to the enrolled team's prefix before Universal Links can work. Before using another signing team, replace its app ID prefix with the application identifier prefix from that team's signed app or provisioning profile. Do not put a local development-team override into the Xcode project.

Associated Domains requires a signing team enrolled in the Apple Developer Program. The current Personal Team cannot provision this capability; Xcode rejects the signed build until an eligible team is selected. An unsigned build can validate native compilation, but cannot verify Universal Links on an iPad.

After deploying the association and signing with an eligible team, reinstall Cup so iOS fetches the association. Apple caches the association through its CDN, so server deployment alone may not update existing devices immediately. Test a trial link from Keep or Notes with Cup closed and already running; verify that it opens the trial and exchanges its credential. Then share an article from Safari and Chrome and verify that the URL appears in that trial's conversion form without submitting it. Browser-specific link handling can affect whether a tap hands control to iOS; use Apple's Universal Links diagnostics if a verified association still opens the browser.

See [Apple's Universal Links troubleshooting](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links/).

## Brand assets

Edit the canonical artwork in `tooling/brand-assets/assets/` at the repository root. Run `pnpm brand-assets:sync` to regenerate native icons, splash images, and web assets, then review the generated changes. Native sync uses the checked-in brand assets without regenerating them. See [the brand asset guide](../../tooling/brand-assets/README.md) for sources, sizing, and validation.

## Progressive playback

Preparation produces text without generating speech. Loading the prepared article requests audio for its selected unit while playback remains paused. Each platform's `NarrationPlaybackCoordinator` owns playback intent, passage selection, and bounded speech synthesis lookahead independently of the WebView. Pause stops speech synthesis lookahead; selecting a unit while paused requests only its audio. Leaving the player stops new scheduling; in-flight workflows can finish and charge. Anonymous positions stay on the device; signed-in positions use the account API and restore only when the player initially loads.

Both platforms separate native playback into the same responsibilities. `NarrationApiClient` owns authentication headers, HTTP, and segment polling; `NarrationPositionStore` restores listening positions and serializes account saves; `NarrationAudioAdapter` owns platform audio, interruptions, lock-screen controls, and buffering background resources. Android's [service](android/app/src/main/java/com/cup_audio/app/NarrationPlaybackService.java) hosts their lifetime, while the [plugin](android/app/src/main/java/com/cup_audio/app/NarrationPlayerPlugin.java) translates Capacitor commands. iOS's [bridge](ios/App/App/NarrationPlayer.swift) constructs the components; the [coordinator](ios/App/App/NarrationPlaybackCoordinator.swift) depends on [protocols](ios/App/App/NarrationPlaybackDependencies.swift) so its scheduling can be tested without AVPlayer or a simulator.

Run `pnpm --filter @cup/mobile-app test:native` on macOS with Xcode's command-line tools to compile and run the native Swift behavior tests. They exercise pause with in-flight synthesis, destination-first seeking, bounded speech synthesis lookahead, initial-only position restoration, explicit retry, stale article responses, and ordered account writes with captured authorization. These tests do not verify operating-system background playback.

Android declares a media playback foreground service and uses Media3 with audio focus and network wake mode. iOS configures a spoken-audio playback session and the audio background mode; a finite background task covers initial buffering and gaps. Operating-system suspension and interruptions can still stop playback. Native bearer-token expiry stops new private requests until playback is reauthorized; dedicated iOS account sign-in remains deferred.

Build checks do not verify physical-device background behavior. On each platform, test starting playback, locking the device through several unit boundaries, using lock-screen Pause and Play, seeking while generation is in flight, unplugging headphones, closing the player, and resuming the saved position on another device. Also test long sessions through authorization expiry. Use the local backend only with the development networking setup; this change does not deploy the backend.
