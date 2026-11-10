---
status: accepted
---

# Sign in on iOS through Supabase OAuth in a system browser sheet

The iOS app reused the web sign-in: `signInWithOAuth` navigated the WebView to Supabase, Capacitor handed that navigation to Safari, and Safari could not open the `capacitor://localhost` redirect back into Cup, so no listener could sign in on iOS ([CUP-60](https://linear.app/cup-audio/issue/CUP-60)). Keeping the flow inside the WebView is no option: Google refuses OAuth in embedded WebViews. Android signs in natively: the Google sign-in plugin returns a Google ID token bound to a nonce, which Supabase exchanges. The fix for CUP-60 chose the iOS flow on 2026-11-10, and [patricktree/cup#227](https://github.com/patricktree/cup/pull/227) implemented it.

## Decision

- **iOS runs Supabase's OAuth flow with PKCE in an `ASWebAuthenticationSession`.** The web app's [iOS adapter](../../apps/web-app/src/platform/account-auth.ios.ts) asks Supabase for the authorization URL without navigating, opens it through the app's own `WebAuthentication` plugin ([`WebAuthenticationPlugin.swift`](../../apps/mobile-app/ios/App/App/WebAuthenticationPlugin.swift)), and exchanges the code that comes back with the PKCE verifier it stored. Google, Supabase's callback and the code exchange are the web's; only the return differs.
- **The sheet returns to `audio.cup.app://auth/callback`.** It uses the app's existing URL scheme, which the session catches itself, so the callback never passes through iOS's URL routing or the share intake. Supabase's redirect allow-list holds that URL in [Terraform](../../terraform/production/supabase.tf) and the [local stack](../../supabase/config.toml).
- **The session is kept in Secure Storage**, the iOS Keychain, as on Android, instead of the WebView's local storage.
- **iOS links no Google sign-in SDK.** The Capacitor configuration includes only the Secure Storage and App plugins on iOS.

## Considered options

- **Native Google sign-in with the Google Sign-In SDK, as on Android.** The installed Capawesome plugin supports iOS. Rejected for now: it needs an iOS OAuth client in Google Cloud, its reversed client ID as a URL scheme, and that client ID added to Supabase's Google provider, none of which existed, and it would bring a second native Google SDK into the app. The [native sign-in research](../research/social-signup/native-social-sso-research.md) asked for native Apple sign-in on iOS, not native Google sign-in.
- **The browser flow through `@capacitor/browser`.** Rejected: `SFSafariViewController` hands the custom-scheme redirect to iOS's URL routing, which another app can claim for the same scheme, and Cup would have to tell the callback apart from a share link in its URL handler. `ASWebAuthenticationSession` is Apple's API for this flow and returns the callback to the caller only.
- **A universal link as the return.** Rejected: [ADR 0017](0017-keep-trial-links-out-of-the-mobile-apps.md) keeps the apps from claiming web links, and a universal link needs Associated Domains and an enrolled team's provisioning.
- **An ephemeral session.** Rejected: it skips iOS's prompt but never sees the Google sign-in Safari already has, so a listener types their Google password every time.

## Consequences

- Before the sheet opens, iOS asks whether "Cup" may use the auth provider's site to sign in. The listener sees Supabase's host there, and Cup cannot change the text.
- The sheet shares Safari's cookies: a listener already signed in to Google in Safari picks the account without a password. Signing out of Cup does not sign Safari out of Google; the account chooser, which every sign-in requests, lets the listener pick another account.
- The Keychain outlives the app: a listener who deletes Cup and installs it again is still signed in, as long as the session's refresh token is valid. The mobile E2E suite resets its simulator's Keychain before each test.
- iOS and Android sign in differently, so a change to the Android adapter does not cover iOS. The [mobile E2E tests](../../qa/mobile-e2e/README.md#sign-in) drive the real `ASWebAuthenticationSession` against the fake auth provider, which redirects to the callback URL without a Google page.
- Production iOS sign-in needs the Terraform change to Supabase's allow-list applied. Real Google in the sheet stays a manual check on a device.
- Sign in with Apple ([CUP-45](https://linear.app/cup-audio/issue/CUP-45)) can use the same sheet through Supabase's Apple provider; App Review may still ask for native Apple sign-in, which is a separate decision.
