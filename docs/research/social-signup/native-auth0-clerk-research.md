# Auth0 and Clerk: native social login in Capacitor

> Historical research, incorporated 2026-10-02. Historical supporting evidence for the [native sign-in comparison](native-social-sso-research.md). Cup uses Supabase; these alternatives are not implemented. External claims retain their original research dates and have not been reverified during this migration.

[Original investigation](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/native-auth0-clerk-research.md).

Researched 2026-09-17. Requirement: Android Google Credential Manager and iOS Apple AuthenticationServices, without browser authentication. This is documentation/source research, not a device-tested integration.

## Findings

| Provider | Google on Android                             | Apple on iOS                                                 | Capacitor verdict                                                                                                                               |
| -------- | --------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth0    | Official native credential exchange exists    | Official native authorization-code exchange exists           | Feasible composition of an existing social-login plugin and Auth0 exchange/session glue; no verified turnkey native Auth0 Capacitor integration |
| Clerk    | Official Android SDK accepts Google ID tokens | Official iOS SDK supports native Apple sign-in and ID tokens | Feasible custom native SDK bridge; no verified maintained Capacitor 8 integration covering both                                                 |

## Auth0

Auth0 now explicitly documents Android Credential Manager login: obtain the Google ID token, enable `native_social_login.google.enabled` on the native application, and call `AuthenticationAPIClient.loginWithNativeSocialToken(idToken, "http://auth0.com/oauth/token-type/google-id-token")`. The Google web client ID supplies the token audience; the Android client identifies the app. Its MFA and enterprise-federation fallback uses browser authentication, which would violate Cup's requirement if enabled for these flows. [Official Google native guide](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/google-native).

This is not the historical unsupported Google flow. Auth0 announced native Google sign-in in its May 2025 product update and published an implementation article in July 2025. Current setup documentation has no Early Access banner or paid-plan restriction, but an explicit Free-plan entitlement guarantee was not located; verify the toggle and successful exchange on the intended tenant. [May 2025 release announcement](https://auth0.com/blog/may-2025-in-auth0-async-auth-real-time-streams-and-custom-everything/), [July implementation article](https://auth0.com/blog/native-google-sign-in-android-apps/).

Apple's documented path calls Apple's native SDK, obtains an authorization code, and posts it to Auth0's `/oauth/token` for Auth0 access/ID/refresh tokens. The native Apple connection and bundle ID must be configured. The main guide specifically warns against passing a nonce for that code-exchange path. [Official Apple native guide](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/apple-native). Auth0's Swift example uses `login(appleAuthorizationCode:fullName:scope:)`. [Official Apple implementation article](https://auth0.com/blog/learn-how-to-implement-sign-in-with-apple-easily/).

An Auth0 support article separately shows Apple ID-token exchange via `exchangeNativeSocial` and `apple-id-token`. Because the main guide instead uses an authorization code, use the documented code path for the initial prototype rather than assume these interchangeable. [Auth0 support example](https://support.auth0.com/center/s/article/Implement-Native-Apple-Sign-In-with-Auth0-in-React-Native).

The existing third-party `@capgo/capacitor-social-login` v8 plugin supports Capacitor 8 and Android Credential Manager. Its Swift `AppleProvider` uses `ASAuthorizationAppleIDProvider`/`ASAuthorizationController`; `useProperTokenExchange` returns the Apple `authorizationCode` without consuming it. Thus both native credentials can be acquired without writing a new UI bridge. Use its `google` and `apple` providers, not its generic Auth0/OIDC preset, which is a browser flow. [Plugin documentation](https://capgo.app/docs/plugins/social-login/), [Apple implementation](https://github.com/Cap-go/capacitor-social-login/blob/main/ios/Sources/SocialLoginPlugin/AppleProvider.swift).

The remaining work is exchanging credentials and owning secure storage, refresh, logout, and React auth state, or bridging Auth0's native SDK credential managers. Receiving Auth0 tokens does not automatically hydrate `@auth0/auth0-react`. This composition is an inference from compatible documented interfaces, not a published, device-tested recipe. The official Ionic React quickstart opens `Browser.open` and does not meet this requirement. [Ionic React quickstart](https://auth0.com/docs/quickstart/native/ionic-react).

Do not confuse native-social exchange with Custom Token Exchange: the latter requires custom validation Actions and is Early Access on B2C Professional, B2B Professional, and Enterprise plans. It is unnecessary for the documented Google and Apple paths. The old `/oauth/access_token` endpoint is deprecated and disabled for new tenants. [Custom Token Exchange configuration](https://auth0.com/docs/authenticate/custom-token-exchange/configure-custom-token-exchange), [Legacy endpoint](https://auth0.com/docs/api/authentication/login-legacy/social-with-providers-access-token).

## Clerk

Clerk explicitly supports Android Credential Manager: send its Google ID token to Clerk, using `Clerk.auth.signInWithIdToken { token = idToken; provider = IdTokenProvider.GOOGLE }`. This establishes Clerk authentication rather than merely obtaining a Google identity. [Android social connections](https://clerk.com/docs/android/guides/configure/auth-strategies/social-connections/overview), [Android auth API](https://clerk.com/docs/android/reference/native-mobile/auth).

On iOS, `clerk.auth.signInWithApple()` provides native Apple authentication; `signInWithIdToken(idToken, provider: .apple)` and corresponding signup methods accept externally acquired credentials. [Apple setup](https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple), [iOS auth API](https://clerk.com/docs/ios/reference/native-mobile/auth).

These are official native SDKs, not Capacitor plugins. A custom Capacitor plugin could bridge them and expose session-token retrieval to Cup's React UI. Alternatively, generic social-login credential acquisition plus Clerk Frontend API integration may be viable, but the complete supported Capacitor JS session-hydration path was not verified. Do not label this impossible; label it custom integration work.

The community package `@trainon-inc/capacitor-clerk-native` exists but does not establish suitability. Version 1.24.0 declares only Capacitor 6/7 peer compatibility. Its README calls Android a web-provider stub, while current source contains direct HTTP password/email authentication; neither demonstrates native Google login. The Android source has no Google, OAuth, or Credential Manager implementation. This README/source discrepancy further limits confidence. [Package manifest](https://github.com/TrainOn-Inc/capacitor-clerk-native/blob/main/package.json), [README](https://github.com/TrainOn-Inc/capacitor-clerk-native), [Android implementation](https://github.com/TrainOn-Inc/capacitor-clerk-native/blob/main/android/src/main/java/com/trainon/capacitor/clerk/ClerkNativePlugin.java).

## Prototype gates

For Auth0, verify native-social toggles on the intended plan, both credential exchanges, secure refresh persistence, and React state without browser fallback. For Clerk, first choose and implement a Capacitor 8 bridge/session architecture, then test Google and Apple login, signup, relaunch, refresh, and logout on physical devices. Neither provider's general native SDK support proves those app-specific details.
