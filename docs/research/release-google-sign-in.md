# Native Google sign-in in a build signed by Play App Signing

Research date: 2026-11-14, for [issue #357](https://github.com/patricktree/cup/issues/357) of the [Android test builds map](https://github.com/patricktree/cup/issues/355). Repository observations are from `main` at `8e5c815d`, with `@capawesome/capacitor-google-sign-in` `0.1.4` (androidx Credentials `1.5.0`, `googleid` `1.1.1`, `play-services-auth` `21.5.0` by the plugin's defaults) and the Terraform `hashicorp/google` provider pinned at `~> 7.0`. Web sources were read on the research date. No Google Cloud or Play Console setting was read or changed, no release build was made and no sign-in was attempted. Points marked _unverified_ need a check with a real Play-installed build.

## Question

Cup's Android app signs in natively with Google through Credential Manager and the Google sign-in plugin. Under Play App Signing, testers' installs carry Google's app signing certificate, not the upload key's. The ticket asks:

1. Which certificate fingerprints must be registered for a Play-installed build, a locally installed release build signed with the upload key, and the debug build?
2. Can one Android OAuth client carry several certificates, or does each need its own client in the same Google Cloud project?
3. Where are Cup's Google Cloud OAuth clients managed today, and can Android OAuth clients be managed with Terraform?
4. What else differs for a release build: the web client ID the plugin passes, Supabase's allowed client IDs, and anything that only shows up in a release build?

## Answer

- **Fingerprints.** Each way of installing the app needs the SHA-1 of the certificate that signed the APK on the device, registered with package `audio.cup.app`. A Play-installed build, on any track including internal testing, carries the **app signing key** certificate from Play Console. A local release build carries the **upload key** certificate. A debug build carries the **debug keystore** of the machine that built it. A new app is now enrolled in **quantum-ready hybrid signing** by default. Play then lists **three** app signing keys to register: the classical key for devices before Android 17, plus a new classical key and an ML-DSA key for Android 17 and later. Which of these certificates Google Play services checks on an Android 17 device is _unverified_. The safe course is to register every fingerprint the App signing page lists.
- **One client per certificate.** The Android client form takes one package name and one SHA-1. No Google page describes a client with several fingerprints, and the plugin says to add a client for every fingerprint. Plan one Android client per certificate, all in the cup-production project that holds the web client: up to three for the Play app signing keys, one for the upload key, and one for each debug keystore that should sign in for real.
- **Management.** Cup's OAuth clients are created by hand in the Google Cloud console. Terraform manages the `cup-production` project and Supabase's Google provider, and takes only the web client's ID and secret as variables. Terraform cannot manage consumer OAuth clients: Google shut down the API that `google_iap_brand` and `google_iap_client` used, and provider 8.0.0 removed both resources. Its upgrade guide says OAuth clients "can no longer be managed programmatically". No other resource in the provider creates an Android OAuth client.
- **Nothing else changes for the web client ID or Supabase.** The app takes the web client ID at runtime from the production Worker's auth configuration (`GOOGLE_WEB_CLIENT_ID`), so release and debug builds pass the same ID. The plugin always takes the web client ID, never an Android one. Google issues the ID token for that web client, which is the one client ID Supabase is configured with. No Android client ID needs listing in Supabase. What does differ in a release build: it has no debug sources, so the real plugin always runs; R8 is off today; and the inactivity rule can delete a rarely used client, such as the upload-key one.

## 1. Which certificate signs what

Android Developers describe the two Play App Signing keys: the app signing key "is used to sign APKs that are installed on a user's device", and the upload key is the one "you use to sign the app bundle or APK before you upload it" ([Sign your app][app-signing]). If Google generates the app signing key, "the key you use to sign your first release becomes your upload key" ([Sign your app][app-signing]), so the two keys differ by default. Google Play signs every APK it delivers, and nothing in Google's documentation exempts the testing tracks. The Play help page says that "Because Google signs the final APK, you must register the Google-held app signing key fingerprint with your API providers, not just your local upload key", and lists OAuth among those providers ([Use Play App Signing][play-app-signing]). The plugin's README says the same for Google sign-in: "Builds distributed via Google Play: the fingerprint of the **app signing key**, not the upload key", found in Play Console under Test and release › Setup › App signing ([plugin README][plugin-readme]).

| Install                                                     | Signed with                                                                              | SHA-1 from                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal testing track (or any track) from the Play Store   | Play app signing key(s)                                                                  | Play Console, App signing page, "App signing key" section                                                                                                                                                     |
| Local `.aab`/`.apk` release build installed with `adb`      | Upload key                                                                               | `keytool -list -v` on the upload keystore, or the "Upload key certificate" section of the same page, which lists MD5, SHA-1 and SHA-256 for both keys ([Sign your app][app-signing])                          |
| Debug build (`pnpm --filter '@cup/mobile-app' android:run`) | That machine's `~/.android/debug.keystore` (`build.gradle` declares no `signingConfigs`) | `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android` ([plugin README][plugin-readme])                                                                             |
| Internal app sharing (not on the map's route)               | A per-account "Internal App Sharing key"                                                 | Play Console, Internal app sharing › "Internal test certificate". Every APK "is resigned with this test certificate, regardless of which certificate you used" ([Internal app sharing][internal-app-sharing]) |

A local release build installed with `adb` signs in only if the upload key's SHA-1 has its own Android client. That build is optional on the map's route, whose acceptance check uses a Play-installed build. Before registering the upload key, decide whether a local release install is needed at all.

### Quantum-ready hybrid signing

The Play help page now says that for a new app, "By default, when you upload your app bundle, your app is automatically enrolled in quantum-ready, hybrid signing with Google-generated keys". The keys are a classical RSA 4096-bit key and a post-quantum ML-DSA-65 key. The help page lists no opt-out. Before a release reaches open testing or production, a developer can instead reuse another app's key or upload their own, and the page does not say whether a key of one's own avoids hybrid signing ([Use Play App Signing][play-app-signing]). For API providers, the page says an app on hybrid signing "must copy the fingerprints for three keys and register each of them with your API providers": the new classical key and the PQC key used on newer devices, and the classical key used on older devices. Its key-upgrade section names only two new keys, so the page contradicts itself ([Use Play App Signing][play-app-signing]). Google announced the scheme on 2026-03-25 for the Android 17 cycle ([Google security blog][pqc-blog]).

On the device side, APK signature scheme v3.2 carries a v3.0 or v3.1 block signed by the classical key K0, which older Android versions verify, next to a hybrid block signed by the new keys. On Android 17 and later, "The platform treats the hybrid block as an implicit key rotation": the classical signer's certificate is treated as "the predecessor to the PQC signer's certificate" ([APK signature scheme v3.2][apk-v3-2]). Neither page says which certificate Google Play services hashes when it matches a calling app to an Android OAuth client on Android 17. It could be K0, the new classical key or the ML-DSA key, so the matching certificate is _unverified_. Registering a client for each fingerprint that Play Console lists under "App signing key" covers all three cases. An extra client does no harm, apart from the six-month inactivity deletion described below.

## 2. One client per certificate

Google Cloud's help on OAuth clients asks for the Android app's "package name and SHA1 fingerprint" and has you paste one SHA-1 into the form. It describes no second fingerprint field and does not say whether a client can hold several ([Manage OAuth clients][manage-clients]). The plugin's README says: "Add an OAuth client for every fingerprint you want to support. A missing fingerprint is the most common cause of a failing sign-in flow" ([plugin README][plugin-readme]). The earlier [emulator research](google-sign-in-android-emulator.md#does-a-committed-debug-keystore-remove-the-per-machine-step) found the same: Google's Fit guide says one client per certificate, and each package and SHA-1 pair "must be unique across all Firebase and Google Cloud projects".

All Android clients belong in the project that holds the web client. The plugin requires the Android client "in the same project as your web client" and passes only the web client ID ([plugin README][plugin-readme]). The help page also warns that "OAuth 2.0 clients that have been inactive for six months are automatically deleted", where unused means no token requests and no settings changes for six months. Google sends an email 30 days before deletion, and a deleted client can be restored for 30 days ([Manage OAuth clients][manage-clients]). A Play-signing client in regular use stays alive. An upload-key client used only for an occasional local release build may not.

The same page offers an optional "verify ownership of your Android application to reduce the risk of app impersonation" step on Android clients ([Manage OAuth clients][manage-clients]). What that verification checks for a Play-distributed app is not described there and was not researched further.

What Cup's existing Android client is registered for is not recorded in the repository. The [production configuration](../production-configuration.md#identity-providers) names only the package, and the [Terraform guide](../../terraform/README.md#google-sign-in-configuration) says native Android sign-in "remains unverified". It is most likely one machine's debug SHA-1, but that is _unverified_.

## 3. Where the clients are managed, and Terraform

From the repository:

- [`terraform/production/main.tf`](../../terraform/production/main.tf) manages only the `google_project` `cup-production`. [`terraform/bootstrap/main.tf`](../../terraform/bootstrap/main.tf) manages the infrastructure project and the state bucket.
- [`terraform/production/supabase.tf`](../../terraform/production/supabase.tf) passes `var.google_web_client_id` and `var.google_web_client_secret` to Supabase's Google provider, with nonce checking on.
- The [Terraform guide](../../terraform/README.md#google-sign-in-configuration) says "The Google Web application OAuth client is created manually in the cup-production Google Auth Platform project", "The Google OAuth client remains outside Terraform state", and "Creating or changing the Google consumer OAuth client remains a manual operation".

From the provider: provider 8.0.0 (2026-08-26) "removed `google_iap_brand` and `google_iap_client` resources" ([provider changelog][tf-changelog]). The upgrade guide gives the reason: "following the permanent shutdown of the Google Cloud IAP OAuth Admin APIs. OAuth consent screens (brands) and OAuth clients can no longer be managed programmatically via the API and must be configured directly in the Google Cloud Console" ([version 8 upgrade guide][tf-v8-upgrade]). Those resources only ever created IAP web clients. Neither the provider's resource list at `v8.11.0` (2026-11-10) nor its `~> 7.0` predecessor has a resource for an Android OAuth client:

- `google_iam_oauth_client` is a Workforce Identity Federation client "used to access Google Cloud resources on behalf of a Workforce Identity Federation user", with no package or fingerprint fields ([provider docs][tf-iam-oauth-client]).
- `google_firebase_android_app` (beta provider) stores `sha1_hashes` on a Firebase Android app ([provider docs][tf-firebase-android-app]). That is Firebase's record of an app, not a Google Cloud OAuth client. Whether Firebase creates matching OAuth clients from these hashes was not checked. It would also bring Firebase into a project that does not use it.
- `google_apikeys_key` restricts an API key to a package and SHA-1, which Google sign-in does not use.

So Android OAuth clients stay manual console work, as the web client is today. The fingerprints themselves can be documented: SHA-1 values are public certificate data.

## 4. What else differs in a release build

**The web client ID.** The [Android adapter](../../apps/web-app/src/platform/account-auth.android.ts) calls `GoogleSignIn.initialize({ clientId })` with `config.googleWebClientId` from the public auth configuration ([`account-session.ts`](../../apps/web-app/src/auth/account-session.ts)). The Worker serves that value from its `GOOGLE_WEB_CLIENT_ID` secret ([`api-server.ts`](../../libs/api-server/src/api-server.ts), [production configuration](../production-configuration.md#worker-configuration)). Nothing is compiled into the APK, and a release build talks to `https://cup.audio` like a debug build launched without a test origin ([mobile app README](../../apps/mobile-app/README.md#debug-launch-arguments)). The plugin requires a **web** client ID on every platform. On Android it is "passed as the server client ID to the Credential Manager API", and "The Android client ID is never passed to the plugin" ([plugin README][plugin-readme]). Google's guide sets `setServerClientId(WEB_CLIENT_ID)` in the same way ([Credential Manager implementation][siwg-impl]). The release build therefore needs no new value.

**Supabase's allowed client IDs.** Supabase Auth's ID-token grant builds its accepted audiences for Google from `config.External.Google.ClientID` and rejects a token whose `aud` contains none of them ([`token_oidc.go`][supabase-token-oidc], last changed 2026-08-10). Terraform sets that list to the web client ID alone (`external_google_client_id`). Google's backend guide verifies an Android app's token with `.setAudience(Collections.singletonList(WEB_CLIENT_ID))` after the app passes "your server's web client ID" ([Authenticate with a backend server][backend-auth]), so the token's `aud` is the web client. Supabase's guide says to "add all of the Client IDs to the Supabase dashboard" and to put the web client first ([Supabase: Login with Google][supabase-google]). That is needed only for platforms whose tokens carry their own client ID, such as iOS's Google SDK, which Cup does not use. No Supabase change is needed for Android release builds. Cup has never completed a native sign-in in production, so this is still _unverified_ end to end.

**Debug-only code is gone.** Only `android/app/src/debug` handles `cupTestApiOrigin`, the `localhost` cleartext exception and `FakeGoogleSignInPlugin`. "Release builds contain none of this" ([mobile app README](../../apps/mobile-app/README.md#debug-launch-arguments)), so a release build always runs the real plugin against production.

**The error for a missing fingerprint.** If no Android client matches the installed certificate, "the account picker opens but the flow fails as soon as an account is picked". Google Play services reports this as a cancellation, `SIGN_IN_CANCELED` with `Account reauth failed` ([plugin README][plugin-readme]). Cup's adapter counts only `[16] Cancelled by user.` and the plugin's own message as the person's choice. A missing client therefore surfaces as "Google sign-in could not be completed. Try again." ([Android adapter](../../apps/web-app/src/platform/account-auth.android.ts)), and logcat shows `[16] Account reauth failed`. This symptom is the one to check in the map's acceptance test when sign-in fails on a Play-installed build.

**R8.** `minifyEnabled false` today, so nothing is stripped. If the spec turns R8 on, androidx `credentials-play-services-auth` `1.5.0` ships its own consumer rule keeping `androidx.credentials.playservices.CredentialProviderPlayServicesImpl` (read from the AAR in the local Gradle cache). `@capacitor/android` ships consumer rules that keep every `@CapacitorPlugin` class and `com.getcapacitor.Plugin` subclass. Whether the plugin's own model classes and the `googleid` library survive R8 is _unverified_ without a minified build.

**The consent screen.** Brand verification decides whether Google shows Cup's name on the consent screen ([Sign in with Google overview][siwg]). The earlier research found that a project in Testing status does not limit apps that request only name, email and profile ([emulator research](google-sign-in-android-emulator.md#does-a-committed-debug-keystore-remove-the-per-machine-step)). Cup's web sign-in already works on the same project and consent screen, so this does not change for release builds.

## Recommendations for the spec

1. After the first upload to the internal testing track, copy the SHA-1 of every certificate in Play Console's "App signing key" section (three under hybrid signing). Create one Android OAuth client per SHA-1 for `audio.cup.app` in the cup-production project. Record the fingerprints and client names in the [production configuration](../production-configuration.md#identity-providers).
2. Register the upload key's SHA-1 only if the spec keeps local release installs with `adb`. Note that its client can be deleted after six months unused.
3. Record which debug keystore the existing Android client is registered for, or confirm it in the console. That decides whether `android:run` debug builds sign in with real Google at all.
4. Keep OAuth clients as documented console steps. Terraform cannot create them, and the repository's provider pin should not chase `google_iap_client`, which is gone in 8.x.
5. Change nothing for the web client ID or Supabase's client ID list.
6. In the acceptance check, sign in on a physical device from the internal testing track. If possible, use both a device before Android 17 and one on Android 17 or later, which settles the open hybrid-signing question. On failure, look for `[16] Account reauth failed` in logcat.

Open points: which certificate Google Play services matches on Android 17 under hybrid signing; whether the existing Android client is for a debug key; whether R8, if enabled, keeps the plugin working; and what the optional app-ownership verification of an Android client does for a Play-signed app.

## Sources

Read 2026-11-14.

- [Use Play App Signing][play-app-signing], Play Console Help.
- [Share app bundles and APKs internally][internal-app-sharing], Play Console Help.
- [Sign your app][app-signing], Android Developers.
- [APK signature scheme v3.2][apk-v3-2], Android Open Source Project.
- [Security for the quantum era: implementing post-quantum cryptography in Android][pqc-blog], Google blog, 2026-03-25.
- [Sign in with Google with Credential Manager][siwg], [its implementation guide][siwg-impl] and [troubleshooting][troubleshooting], Android Developers.
- [Manage OAuth clients][manage-clients], Google Cloud Help.
- [Authenticate with a backend server][backend-auth], Google Identity (its links point at the legacy Google Sign-In guides; cited only for the audience).
- Terraform `hashicorp/google`: [CHANGELOG][tf-changelog], [version 8 upgrade guide][tf-v8-upgrade], [`google_iam_oauth_client`][tf-iam-oauth-client], [`google_firebase_android_app`][tf-firebase-android-app], read from the provider repository at release `v8.11.0`.
- [Login with Google][supabase-google], Supabase documentation, and [`internal/api/token_oidc.go`][supabase-token-oidc] in `supabase/auth` at `d6dec264`.
- `@capawesome/capacitor-google-sign-in` `0.1.4` [README][plugin-readme], from the installed package.
- Local: `credentials-play-services-auth-1.5.0.aar` `proguard.txt` in `~/.gradle/caches`, and `@capacitor/android` `proguard-rules.pro` in `node_modules`.

[play-app-signing]: https://support.google.com/googleplay/android-developer/answer/9842756
[internal-app-sharing]: https://support.google.com/googleplay/android-developer/answer/9844679
[app-signing]: https://developer.android.com/studio/publish/app-signing
[apk-v3-2]: https://source.android.com/docs/security/features/apksigning/v3-2
[pqc-blog]: https://blog.google/security/security-for-the-quantum-era-implementing-post-quantum-cryptography-in-android/
[siwg]: https://developer.android.com/identity/sign-in/credential-manager-siwg
[siwg-impl]: https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
[troubleshooting]: https://developer.android.com/identity/sign-in/credential-manager-troubleshooting-guide
[manage-clients]: https://support.google.com/cloud/answer/15549257
[backend-auth]: https://developers.google.com/identity/sign-in/android/backend-auth
[tf-changelog]: https://github.com/hashicorp/terraform-provider-google/blob/v8.11.0/CHANGELOG.md
[tf-v8-upgrade]: https://github.com/hashicorp/terraform-provider-google/blob/v8.11.0/website/docs/guides/version_8_upgrade.html.markdown
[tf-iam-oauth-client]: https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/iam_oauth_client
[tf-firebase-android-app]: https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/firebase_android_app
[supabase-google]: https://supabase.com/docs/guides/auth/social-login/auth-google
[supabase-token-oidc]: https://github.com/supabase/auth/blob/d6dec2640f047a42873e64ccec2f7288043d511f/internal/api/token_oidc.go
[plugin-readme]: https://github.com/capawesome-team/capacitor-plugins/tree/main/packages/google-sign-in
