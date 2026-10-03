# Native social sign-in through Capacitor

> Historical research, incorporated 2026-10-02. Cup implements Google sign-in with Supabase on web and Android. Apple sign-in and native iOS account support remain deferred. Provider comparisons and prototype requirements below describe the investigation, not completed validation. See [current authentication](../../architecture/authentication.md) and [deferred Apple/iOS work](deferred-apple-ios.md). External claims retain their original research dates and have not been reverified during this migration.

[Original investigation](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/native-social-sso-research.md).

Researched 2026-09-17 for Cup's Capacitor 8 application. This report checks native Google sign-in on Android and native Apple sign-in on iOS, followed by authentication with each managed service. It supersedes the earlier provider recommendation where that recommendation relied on browser-based mobile login. No provider is selected by this research.

## What qualifies

Google's Android Credential Manager presents the native account-selection/sign-in experience; Apple's AuthenticationServices presents the native Apple authorization sheet. A system browser, Chrome Custom Tab, Safari view, ASWebAuthenticationSession, or hosted login page does not qualify merely because it appears inside the app. The provider must also accept the resulting Google/Apple credential and issue its own user session. [Google native sign-in](https://developer.android.com/identity/sign-in/credential-manager-siwg), [Apple native sign-in](https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple).

## Comparison

| Managed service           | Native Google on Android               | Native Apple on iOS                    | Existing Capacitor path and remaining work                                                                                                                                                                      |
| ------------------------- | -------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase Authentication   | Yes                                    | Yes                                    | Capawesome's third-party @capacitor-firebase/authentication supports Capacitor 8 and both native flows, including Firebase session creation. Choose native or JS session ownership deliberately.                |
| Supabase Auth             | Yes                                    | Yes                                    | Existing Capacitor 8 native social plugins plus official signInWithIdToken. Small application adapter; no new native bridge required.                                                                           |
| Auth0                     | Yes, supported exchange                | Yes, supported exchange                | Capgo's existing Capacitor 8 social plugin supplies native credentials; compose it with Auth0 native-social token exchange and session management. No verified all-in-one native Auth0 Capacitor integration.   |
| Clerk                     | Yes in official native SDK             | Yes in official native SDK             | No verified Capacitor 8 integration covering both. A custom native SDK bridge or another validated session adapter is needed.                                                                                   |
| Stytch Consumer           | Yes in official native SDK             | Yes in official native SDK             | No verified maintained Capacitor wrapper. Native SDK bridging is a concrete custom path; direct token/session integration needs further validation.                                                             |
| Amazon Cognito user pools | Not through standard social federation | Not through standard social federation | Standard social login uses browser federation. Identity pools accept native tokens but return AWS credentials, not an equivalent user-pool session. Custom authentication would be substantial additional work. |

These verdicts are based on current documentation and source inspection, not device tests in Cup. The per-provider evidence follows.

## Firebase Authentication

Capawesome's @capacitor-firebase/authentication 8.5.2 declares Capacitor core >=8.0.0. Its Android Google handler invokes Credential Manager; its iOS Apple handler invokes ASAuthorizationAppleIDProvider and ASAuthorizationController. The plugin then establishes a Firebase session. This is an existing third-party integration, not a Google-maintained Capacitor SDK. [Plugin documentation](https://capawesome.io/docs/sdks/capacitor/firebase/authentication/), [package and source evidence](native-firebase-supabase-research.md).

Use FirebaseAuthentication.signInWithGoogle({ useCredentialManager: true }) and FirebaseAuthentication.signInWithApple(). Native Firebase and Firebase JS sessions are separate. The documented Apple-to-JS session route requires skipNativeAuth: true; despite its name, this skips native Firebase session creation, not the native Apple prompt. [Maintainer JS integration guide](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/firebase-js-sdk.md).

## Supabase Auth

Capawesome's @capawesome/capacitor-google-sign-in and @capawesome/capacitor-apple-sign-in expose the required native APIs and explicitly support Capacitor 8. Send their resulting ID tokens to supabase.auth.signInWithIdToken to obtain the Supabase session. This is supported native credential acquisition composed with a supported SaaS API, requiring a small JavaScript adapter rather than a custom native plugin. [Google plugin](https://capawesome.io/docs/sdks/capacitor/google-sign-in/), [Apple plugin](https://capawesome.io/docs/sdks/capacitor/apple-sign-in/), [Supabase token exchange](https://supabase.com/docs/reference/javascript/auth-signinwithidtoken).

Capgo also documents a Supabase integration using @capgo/capacitor-social-login; its current 8.5.9 manifest accepts Capacitor >=8. The detailed source review in this effort verified the Capawesome path, so do not assume nonce/session behavior is interchangeable between plugin packages. [Capgo Supabase integration](https://capgo.app/docs/plugins/social-login/supabase/introduction/), [Capgo package manifest](https://github.com/Cap-go/capacitor-social-login/blob/main/package.json).

Configure token audiences and nonce handling correctly, then handle Supabase session persistence and refresh. Do not use signInWithOAuth for these target native flows. [Detailed Firebase/Supabase findings](native-firebase-supabase-research.md).

## Auth0

Auth0 now supports native Google Android ID-token exchange, announced in 2025; old discussions saying it is unsupported are stale. Its native Apple path exchanges the Apple authorization code for Auth0 tokens. These are native-social exchange features, distinct from the separately restricted Custom Token Exchange product. [Google native guide](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/google-native), [Apple native guide](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/apple-native).

Capgo's native google and apple providers can supply those credentials. Cup still needs Auth0 exchange, secure token persistence, refresh, logout, and React auth-state integration, or a bridge to Auth0's native credential managers. Receiving Auth0 tokens does not automatically sign in @auth0/auth0-react. Verify native-social enablement on the intended tenant/plan; current docs do not show an Early Access restriction, but explicit Free-plan entitlement was not established. The official Ionic React browser quickstart fails this native-only requirement. [Detailed Auth0/Clerk findings](native-auth0-clerk-research.md).

## Clerk

Clerk's official Android SDK accepts Credential Manager's Google token through signInWithIdToken; its iOS SDK offers native signInWithApple. That proves the service capability, not a ready Capacitor integration. [Android native authentication](https://clerk.com/docs/android/reference/native-mobile/auth), [iOS native authentication](https://clerk.com/docs/ios/reference/native-mobile/auth).

The inspected community @trainon-inc/capacitor-clerk-native package only declares Capacitor 6/7 compatibility, and its Android implementation lacks native Google login. Its existence therefore does not satisfy Cup's two-platform requirement. A custom bridge around the official native SDKs is viable; a complete generic-plugin-to-Clerk-JS-session path was not verified. [Detailed package/source findings](native-auth0-clerk-research.md).

## Stytch Consumer

Stytch's stable Android source invokes Credential Manager and exchanges the Google ID token for a Stytch session; its stable iOS source invokes native Apple authorization and exchanges the Apple ID token and nonce for a Stytch session. [Android native implementation](https://github.com/stytchauth/stytch-android/blob/main/source/sdk/src/main/java/com/stytch/sdk/consumer/oauth/GoogleOneTapImpl.kt), [Apple native implementation](https://github.com/stytchauth/stytch-ios/blob/main/Sources/StytchCore/StytchClient/OAuth/OAuth+Apple.swift).

No maintained dedicated Capacitor wrapper was verified. Wrapping these stable SDKs is a concrete custom option. Current newer mobile SDK documentation also exposes ID-token exchange APIs, but describes that SDK generation as public beta; direct SDK endpoint calls and session storage would require validation rather than assuming the ordinary JS SDK handles everything. [Detailed Cognito/Stytch findings](native-cognito-stytch-research.md).

## Amazon Cognito

AWS explicitly separates external-provider federation from the user-pools API: standard social federation uses the OAuth/browser path. Cognito identity pools can accept native Google/Apple tokens, but yield identity IDs and temporary AWS credentials, not Cognito user-pool access/ID/refresh tokens. This is a materially different account/session model. [AWS authentication models](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flows-public-server-side.html), [AWS authentication overview](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-how-to-authenticate.html).

Native provider tokens could become inputs to developer-owned CUSTOM_AUTH Lambda challenges, but then Cup would own verification, provisioning, and identity mapping. That is not an existing equivalent of Firebase's or Supabase's native login integration. [Detailed Cognito/Stytch findings](native-cognito-stytch-research.md).

## Implication for provider selection

Firebase and Supabase are the strongest candidates if the priority is existing Capacitor integration with little custom authentication machinery. Auth0 remains viable, with more session integration work than the earlier browser-based quickstart suggested. Clerk and Stytch remain possible if maintaining custom integration is acceptable. Cognito is a poor fit for this requirement through its standard user-pool social federation. This ranking is an engineering judgment about integration effort, not a full pricing or product comparison.

The next prototype must demonstrate native Google on Android and native Apple on iOS in Cup, including real service sessions, first/returning login, cancellation, restart, refresh, logout, and Worker verification. Native APIs describe the intended path; exceptional device/provider account setup and recovery screens remain controlled by Google/Apple. Do not silently use browser fallback for a failed native login. This research does not add a native-only requirement for Google on iOS or Apple on Android.
