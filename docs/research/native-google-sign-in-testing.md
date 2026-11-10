# Testing a real native Google sign-in on an Android emulator

> Historical research, incorporated 2026-11-10 by [ADR 0018](../adr/0018-test-the-mobile-apps-with-appium-through-webdriverio-on-host-owned-emulators-and-simulators.md), whose rejection of a real Google sign-in cites its per-machine cost. One of two investigations of [issue #187](https://github.com/patricktree/cup/issues/187); the other is [Real native Google sign-in on an Android emulator](google-sign-in-android-emulator.md). Cup did not build a real sign-in: [patricktree/cup#183](https://github.com/patricktree/cup/issues/183) chose a debug-only fake of the Google sign-in plugin plus one test that opens and cancels Google's add-account screen, and the real sign-in is future work in [CUP-59](https://linear.app/cup-audio/issue/CUP-59/test-a-real-native-google-sign-in-on-the-android-emulator). External claims have not been reverified.

[Original investigation](https://github.com/patricktree/cup/blob/25d674a3c3de750d646dbb92c7f4b82afbebdc0f/docs/research/native-google-sign-in-testing.md).

Research date: 2026-11-06, for [issue #187](https://github.com/patricktree/cup/issues/187) of the [mobile QA map](https://github.com/patricktree/cup/issues/179). Repository observations are from `main` at `626776ac`. Library versions are the ones the debug build resolves: `@capawesome/capacitor-google-sign-in` `0.1.4`, `androidx.credentials` `1.5.0`, `googleid` `1.1.1`. One experiment ran on this Mac (M4 Max, Emulator 36, API 36 `google_apis_playstore` arm64 image with Google Play services `25.08.34`); everything else is read from Google's documentation or library bytecode. No Google account was signed in, no credential was entered, and no Google Cloud setting was changed, so every statement about a signed-in emulator is unverified.

## Question

What does it take for an automated test on an Android emulator to complete a real native Google sign-in in Cup's debug build: open the Credential Manager sheet that `GetSignInWithGoogleOption` starts, choose a Google account and receive a real ID token? What does each approach cost per developer machine, and is that cost a Google Cloud step on every machine? The user falls back to only opening and dismissing the picker if a real sign-in needs per-machine Google Cloud setup.

## Answer

1. **Zero per-machine Google Cloud steps is achievable.** Google matches the app by package name and signing-certificate SHA-1. Debug builds today sign with each Mac's own `~/.android/debug.keystore`, so each Mac has a different SHA-1. Committing one test keystore and pointing the debug `signingConfig` at it gives every machine the same SHA-1, which is registered once on one Android OAuth client. That registration and the matching web client are one-time Google Cloud work, best in a separate test project (see [Shared keystore](#a-shared-debug-keystore)).
2. **Per-machine human steps remain, and they are Google-account steps, not Google Cloud steps.** Each Mac's emulator needs the dedicated test Google account signed in once, by a person, through Google's interactive add-account flow; the suite then boots that AVD with `-read-only`. The test account's password (and any second factor) must reach every developer. The sign-in is repeated when the AVD is recreated, and possibly when Google asks the account to verify itself again.
3. **The fallback works with no account and no Google Cloud step, observed.** On an emulator with no Google account, tapping **Continue with Google** opened Google's full-screen add-account flow, not an account picker. Pressing back returned `SIGN_IN_CANCELED` (`[16] Cancelled by user.`) to the app, which showed the message in its sign-in dialog. What an unregistered SHA-1 does once an account exists was not observable without signing in.
4. **Reliability risks are real but bounded.** Google says it may block sign-ins from browsers "controlled through software automation", which argues for a human doing the one-time add-account step rather than the suite. Snapshot invalidation, Play services updates, re-verification prompts and concurrent use of one account from several emulators are the remaining risks. The account sheet itself is reachable for UI Automator.

## What Google checks before it returns an ID token

Cup's [`account-auth.android.ts`](../../apps/web-app/src/platform/account-auth.android.ts) calls `GoogleSignIn.initialize({ clientId })` with the `googleWebClientId` from the Worker's auth configuration, then `GoogleSignIn.signIn({ nonce: hashedNonce })`, then `client.auth.signInWithIdToken({ provider: "google", token, nonce })`. The plugin's `android/src/main/java/io/capawesome/capacitorjs/plugins/googlesignin/GoogleSignIn.java` (in `node_modules`) builds a `GetSignInWithGoogleOption` with that web client ID as server client ID and the nonce, and calls `CredentialManager.getCredentialAsync`.

Google's prerequisites are a configured Google Auth Platform project, whose "client ID configured in the Google Auth Platform" goes into the request ([Sign in with Google overview](https://developer.android.com/identity/sign-in/credential-manager-siwg#prerequisites)). The Android client is created with the app's package name and "the SHA1 fingerprint for your digitally signed .apk file's public certificate" ([Google Cloud help, OAuth clients](https://support.google.com/cloud/answer/15549257)). The [Sign in with Google codelab](https://codelabs.developers.google.com/sign-in-with-google-android) creates a Web client and an Android client on the same project's Clients page, takes the SHA-1 from `~/.android/debug.keystore`, and passes the web client ID to the code. The ID token's audience is then the web client ID; a verifier checks the signature against Google's keys at `https://www.googleapis.com/oauth2/v3/certs`, `aud` against "one of your app's client IDs", `iss` and `exp` ([Verify the Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)).

Production registers the Android client for `audio.cup.app` and its signing certificate ([production configuration](../production-configuration.md#identity-providers)). Whether any debug SHA-1 is registered on it is not recorded in the repository.

What happens when the SHA-1 does not match is not documented on a Google page found for this research. Google's [Credential Manager troubleshooting](https://developer.android.com/identity/sign-in/credential-manager-troubleshooting-guide) says `GetCredentialCancellationException`, while "most commonly" a user cancellation, "can also signal that the request was not authorized due to technical constraints", and that frequent cancellations "may actually indicate a misconfiguration". The plugin's own comment says "Google Play services also reports configuration errors (e.g. a missing Android OAuth client) as a cancellation". Community reports name the message `[28444] Developer console is not set up correctly`, the Credential Manager form of the legacy `ApiException: 10`; that wording is _unverified_ here.

### Does the sheet open without an account?

Google's overview says "If no Google Accounts exist on the device, the bottom sheet UI does not appear", while the button flow "allows users to add a new account to the device" ([overview](https://developer.android.com/identity/sign-in/credential-manager-siwg#user-interface-guidelines)). `GetSignInWithGoogleOption` is the button flow: "A request to retrieve user's Google ID Token from an explicit 'Sign in with Google' button" ([reference](https://developers.google.com/identity/android-credential-manager/android/reference/com/google/android/libraries/identity/googleid/GetSignInWithGoogleOption)), and the implementation guide recommends it when "There are no Google Accounts on the device" ([implementation](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation#create-the-button-flow)). The codelab's `NoCredentialException` warning for a device without an account applies to the bottom sheet's `GetGoogleIdOption`, not to this option.

Observed on a fresh AVD with no account (`dumpsys account` reported `Accounts: 0`), running the current debug build signed with this Mac's debug key (SHA-1 `A3:38:65:6D:…`) and the production web client ID that `https://cup.audio/api/auth/config` serves:

- Tapping **Continue with Google** started the framework's `com.android.credentialmanager/.CredentialSelectorActivity`, then Play services' `auth.api.credentials.assistedsignin.ui.GoogleSignInActivity`, then `auth.uiflows.minutemaid.MinuteMaidActivity`. That screen showed "Checking info…", then Google's "Sign in with ease" phone-number lookup with **Skip** and **Next**; **Skip** led to the add-account page (email field `identifierId`, **Create account**, **Forgot email?**).
- Back from that page returned the app to its dialog within a second. Logcat showed `GoogleSignInPlugin: [16] Cancelled by user.` and Capacitor sent `{"code":"SIGN_IN_CANCELED","message":"[16] Cancelled by user."}`; the dialog displayed "[16] Cancelled by user.".
- No SHA-1 error appeared before the add-account flow, so the package and certificate check, if any, happens later or not at all on this path. Whether this Mac's SHA-1 is registered for `audio.cup.app` is unknown.

So the fallback suite needs no account and no Google Cloud step, but it should assert on the add-account screen (`MinuteMaidActivity`, or the `identifierId` field), not on an account chooser. It needs internet access, since the add-account screen loads from Google, and a Google Play or Google APIs image with Play services.

No fake provider can stand in. `GetSignInWithGoogleOption`'s constructor in `googleid` `1.1.1` calls `GetCustomCredentialOption` with `isSystemProviderRequired = true` and type `com.google.android.libraries.identity.googleid.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL` (read with `javap`), so only the system's Google provider answers it. Google documents no test or fake credential provider for Sign in with Google; the closest Google offering is Firebase Test Lab's Robo test, which signs in with "a Google test account", "One automatic sign-in account … per combination of project and app package", only in Google's cloud ([Robo test](https://firebase.google.com/docs/test-lab/robo-ux-test)).

## A shared debug keystore

[`build.gradle`](../../apps/mobile-app/android/app/build.gradle) declares no `signingConfig`, so the debug build uses the default debug keystore. Android Studio creates it "the first time you run or debug your project" in `$HOME/.android/debug.keystore` with fixed passwords, and it is valid for 30 years ([Sign your debug build](https://developer.android.com/studio/publish/app-signing#debug-mode)). Each Mac therefore has its own key and SHA-1. A `signingConfigs.debug` that points `storeFile` at a committed keystore, assigned to `buildTypes.debug`, makes every machine produce the same certificate ([build variants signing](https://developer.android.com/studio/build/build-variants#signing)). The debug certificate "is insecure by design" and stores reject it, so committing one costs no release security by itself.

Registration constraints:

- An Android client takes one SHA-1 in its form; Google's help page describes no second fingerprint field ([OAuth clients](https://support.google.com/cloud/answer/15549257)). Several SHA-1s mean several Android clients in the same project; Google's [client-auth guide](https://developers.google.com/android/guides/client-auth) expects both debug and release fingerprints.
- Every pairing of package name and SHA-1 "must be unique across all Firebase and Google Cloud projects" ([Firebase help](https://support.google.com/firebase/answer/6401008)). `audio.cup.app` with the shared test SHA-1 can thus live in exactly one project, and per-developer debug SHA-1s would each need their own client.
- Google has no test-only client type. A project's "Testing" publishing status limits the app to 100 listed test users and expires their authorizations after seven days, but apps that request only `openid`, `email` and `profile` are exempt from the list, the warning and the expiry ([Audience](https://support.google.com/cloud/answer/15549945)). Cup requests no extra scopes (the plugin calls `authorize` only when `scopes` is set), so a test project can stay in Testing without these limits applying.

A committed private key lets anyone sign an APK as `audio.cup.app` with the registered certificate. If that certificate sat on the production project, such an app sideloaded onto a victim's phone could obtain ID tokens whose audience production Supabase accepts. A separate Google Cloud test project, with its own web client and an Android client for `audio.cup.app` plus the shared SHA-1, avoids that: production Supabase does not accept the test web client as audience. The local Worker already serves `googleWebClientId` from configuration ([ADR 0012](../adr/0012-offer-a-local-test-account-instead-of-google-in-development.md) made it optional), so a test run can serve the test project's web client ID, which is public and can be committed.

One-time setup is then: create the test project, its web client, one Android client (`audio.cup.app`, shared SHA-1) and the test Google account. None of it repeats per machine.

## Getting a test account onto the emulator

The installed `google_apis_playstore` arm64 images for API 36 and 36.1 include Play services, which `GetSignInWithGoogleOption` needs; the [Gradle Managed Devices](https://developer.android.com/studio/test/managed-devices) ATD images remove system apps and are unsuitable. The codelab signs the account in through the emulator's Settings app; the add-account page observed above is the same Google web sign-in inside `MinuteMaidActivity`.

Signing in must be interactive. Google "might stop sign-ins from browsers that" are "controlled through software automation rather than a human" or "embedded in a different application" ([Google Account help](https://support.google.com/accounts/answer/7675428)). The suite should therefore not script the add-account flow; a person adds the account once per AVD. A sign-in on a new device may also ask for a second factor or another identity check, which a person answers; Google documents its "verify it's you" step only for sensitive account actions ([verification help](https://support.google.com/accounts/answer/7162782)), so this is expected, not documented. Creating the account itself may require phone verification; that was not tried.

Keeping the sign-in: account data lives in the AVD's user data, and a Quick Boot snapshot saved after sign-in restores it. "Any update to the Android Emulator, system image, or AVD settings resets the AVD's saved state", so the next start is a cold boot ([snapshots](https://developer.android.com/studio/run/emulator-snapshots)). A cold boot keeps the user data, so the account should survive and only the snapshot needs re-saving; that is an inference, not observed. Snapshots are not described as portable between machines, so each Mac creates its own AVD and signs in once. The [emulator research](https://github.com/patricktree/cup/blob/7bd843c76170eab01082097d3fac6e27f6ae8b88/docs/research/mobile-emulators-simulators-macos.md) measured `-read-only` Quick Boot loads of 1.6 s, also for two instances of one AVD at once, and a `-read-only` run never writes the account state back.

How long such a sign-in stays valid is not documented on any Google page found. Google deletes personal accounts inactive for two years, and signing in counts as activity ([inactive account policy](https://support.google.com/accounts/answer/12418290)); regular test runs keep the account alive. A password change, security review or Google's risk checks can still sign the device out, so the suite should detect a missing account (`adb -s <serial> shell dumpsys account`) and fail with a message telling the developer to sign in again rather than time out on the sheet.

## Driving the sheet

The [UI Automator guide](https://developer.android.com/training/testing/other-components/ui-automator) says its APIs "interact with user apps and system apps". In the experiment, `uiautomator dump` exposed the Play services screens: the "Sign in with ease" page as `com.google.android.gms:id/minute_maid` with **SKIP**/**NEXT** buttons, and the add-account page's WebView with `identifierId`, **Create account** and **Next**. The account chooser and the first-sign-in consent screen of a signed-in device were not seen, so their selectors are _unverified_; the [mobile E2E tools research](https://github.com/patricktree/cup/blob/7c2407d48fc41687130f5e0c48c538887ad7d83f/docs/research/mobile-e2e-tools.md) found that Appium's UiAutomator2 driver reaches the same tree.

Risks for a real sign-in:

- Consent appears only on an account's first sign-in to the web client; after that the chooser alone remains. Consent is stored by Google per account, not per device, so after the first run on any machine no machine sees it again. A test should accept either screen.
- `GetSignInWithGoogleOption` sets `isAutoSelectAllowed = true` in its bytecode. Whether the system then skips the chooser for a single authorized account is not documented for this option. Cup's fresh sign-in calls `signOut` (`clearCredentialState`) first, which the [implementation guide](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation#handle-sign-out) says gives "users full sign-in options the next time".
- The sheet's text comes from Play services and changes with its version (`25.08.34` on this image) and the device language. Select by resource ID or role where possible, pin the system image, and set the AVD's locale.
- One test account used by several emulators at once, on one Mac or several, may trigger Google's risk checks; Firebase notes that apps preventing "multiple concurrent sign-ins from a single account" need sequential tests ([Robo test](https://firebase.google.com/docs/test-lab/robo-ux-test)). One account per developer avoids the shared-account question at the cost of more accounts.

## Turning the real ID token into a Cup session

The local fake provider in [`auth-provider.ts`](https://github.com/patricktree/cup/blob/626776ac/qa/e2e/test-e2e/auth-provider.ts) implements only `/auth/v1/authorize` and the PKCE token exchange with its own signing key; it has no `grant_type=id_token` handler. `signInWithIdToken` posts `{ provider, id_token, nonce }` to `/auth/v1/token?grant_type=id_token` (`@supabase/auth-js` `2.117.3`, `GoTrueClient.js`), with the raw nonce. A handler for it would verify the token against Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`), check `iss`, `exp`, `aud` equal to the test web client ID, and compare the token's `nonce` with the SHA-256 hex of the raw nonce Cup sends, then issue the same provider-signed access token with `app_metadata.provider` `google` that the PKCE path issues. The run then needs internet access for the JWKS and for the sheet itself. This is the one piece of new test code; it is ordinary and does not depend on the emulator.

## Recommendation

A real end-to-end native sign-in does not need a Google Cloud step on every developer machine. Set it up once: a separate Google Cloud test project with a web client and one Android client for `audio.cup.app` and a committed test keystore's SHA-1, a debug `signingConfig` using that keystore, a dedicated test Google account, and an `id_token` grant in the fake auth provider. The per-machine cost is one human sign-in of the test account on the suite's AVD, plus distributing that account's credentials, repeated when the AVD is recreated or Google signs the device out.

If even that per-machine human step is unacceptable, the fallback is cheap and was observed to work: on an account-less AVD the button opens Google's add-account flow, back returns `SIGN_IN_CANCELED`, and the suite fakes the session. It proves that the native request reaches Play services, but not that Google accepts Cup's package, certificate and client configuration.

## Open questions

- What an account-holding emulator shows when the SHA-1 is not registered, and at which step: needs a signed-in test account.
- The chooser's and consent screen's UI Automator selectors, and whether auto-select skips the chooser after `clearCredentialState`.
- Whether Google's risk checks or a second factor interrupt the one-time emulator sign-in, and how often a signed-in emulator gets signed out.
- Whether the shared-keystore debug build should replace per-machine debug keys for everyday development too, or only for the test build.

## Reproduction

```sh
pnpm install
pnpm --filter '@cup/mobile-app' build
cd apps/mobile-app/android && ./gradlew assembleDebug
export ANDROID_AVD_HOME="$(mktemp -d)"
avdmanager create avd -n siwg-research -k "system-images;android-36;google_apis_playstore;arm64-v8a" -d pixel_7
emulator -avd siwg-research -no-window -no-snapshot -no-audio -ports 5620,5621 &
adb -s emulator-5620 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5620 shell am start -n audio.cup.app/.MainActivity
# Enter a URL, tap Listen, then Continue with Google; observe, then press back.
adb -s emulator-5620 logcat -d | grep -E "GoogleSignInPlugin|Sending plugin error"
adb -s emulator-5620 emu kill
```
