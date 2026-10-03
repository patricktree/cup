# Native Capacitor sign-in: Cognito and Stytch

> Historical research, incorporated 2026-10-02. Historical supporting evidence for the [native sign-in comparison](native-social-sso-research.md). Cup uses Supabase; these alternatives are not implemented. External claims retain their original research dates and have not been reverified during this migration.

[Original investigation](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/native-cognito-stytch-research.md).

Researched 2026-09-17. Requirement: Google’s native Android account flow and Apple’s native iOS authorization sheet, followed by the auth SaaS’s user/session creation. Browser-based OAuth, including browser sheets, does not qualify. This is documentation and source research, not a device test.

## Findings

| Provider                  | Google on Android                                                    | Apple on iOS                                                         | Capacitor conclusion                                                                                         |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Amazon Cognito user pools | No documented built-in native provider-token exchange                | No documented built-in native provider-token exchange                | Does not meet the requirement through standard social federation; substantial custom authentication possible |
| Stytch Consumer           | Native SDK implements Credential Manager and Stytch session exchange | Native SDK implements Sign in with Apple and Stytch session exchange | Native capability exists, but no maintained Stytch Capacitor integration was verified; custom bridge needed  |

## Amazon Cognito

### Why ordinary social federation does not qualify

AWS explicitly states that the user-pools API cannot sign in users federating through an external identity provider. Its documented social federation uses an OAuth authorization flow through managed login/the external provider and returns Cognito tokens afterward. Selecting Google or Apple directly can bypass the provider-selection screen, but does not turn this into a native Credential Manager or AuthenticationServices flow. [AWS authorization models](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flows-public-server-side.html), [federated user-pool sign-in](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation.html).

### Identity pools are a different product boundary

Cognito identity pools accept Google/Apple proof of authentication, including a token acquired with a native SDK. They return an identity identifier and temporary AWS credentials; they do not thereby create the user-pool session and user-pool access/ID/refresh tokens Cup is comparing with Firebase, Supabase, or Stytch. This is not evidence of an equivalent native user-pool login integration. [AWS authentication overview](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-how-to-authenticate.html), [identity-pool providers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-identity.html), [Google identity-pool integration](https://docs.aws.amazon.com/cognito/latest/developerguide/google.html).

### Custom path and responsibility

An app could acquire native Google/Apple tokens with a Capacitor plugin and design a Cognito `CUSTOM_AUTH` challenge around them. AWS supports `InitiateAuth`, `RespondToAuthChallenge`, and three developer-owned Lambda triggers that define, create, and verify challenges before issuing tokens. This establishes a possible mechanism, not a turnkey social token exchange. Cup would own provider-token verification, audience/issuer/nonce/replay handling, user provisioning and identity mapping, and secure linking behavior. These are inferred implementation responsibilities, not functionality proven by a ready-made Cognito Capacitor package. [AWS custom authentication](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-challenge.html).

Capgo’s maintained `@capgo/capacitor-social-login` v8 supports Capacitor 8 and can supply the native provider token. Its separate Cognito/Auth Connect compatibility option should not be confused with that token-to-user-pool exchange: a generic OAuth wrapper does not remove Cognito’s federation constraint. [Capgo plugin overview and compatibility](https://capgo.app/docs/plugins/social-login/).

**Verdict:** Exclude Cognito from the straightforward integration shortlist for this requirement. Keep it only if custom AWS authentication infrastructure is acceptable.

## Stytch Consumer

### Native Android Google flow is implemented

The stable `stytch-android` source implements `OAuth.GoogleOneTap.start`: it invokes Android `CredentialManager`, creates a `GetGoogleIdOption` with server client ID and nonce, extracts `GoogleIdTokenCredential.idToken`, and calls `authenticateWithGoogleIdToken`. On success it updates native session storage. Despite the historical One Tap naming, the implementation uses Credential Manager. This is a native UI followed by a Stytch authentication exchange, not merely Google token collection. [Stytch Android implementation](https://github.com/stytchauth/stytch-android/blob/main/source/sdk/src/main/java/com/stytch/sdk/consumer/oauth/GoogleOneTapImpl.kt).

### Native iOS Apple flow is implemented

The stable `stytch-ios` implementation exposes `StytchClient.oauth.apple.start(parameters:)`. It imports AuthenticationServices, invokes its native Apple authorization client with a hashed nonce, then posts the resulting ID token and original nonce to Stytch. The response includes the Stytch user, session, opaque session token, and session JWT. [Stytch Apple implementation](https://github.com/stytchauth/stytch-ios/blob/main/Sources/StytchCore/StytchClient/OAuth/OAuth+Apple.swift).

### Explicit token exchange also exists

Current mobile SDK documentation exposes `authenticateGoogleIdToken` and `authenticateAppleIdToken`, backed by `POST /sdk/v1/oauth/google/id_token/authenticate` and `POST /sdk/v1/oauth/apple/id_token/authenticate`. Responses include `userId`, `userCreated`, `sessionToken`, and `sessionJwt`. These are SDK endpoints, not evidence that the ordinary backend OAuth authenticate endpoint accepts raw provider ID tokens. [Google ID-token exchange](https://stytch.com/docs/api-reference/consumer/mobile-sdks/android/methods/oauth/authenticate-google-id-token), [Apple ID-token exchange](https://stytch.com/docs/api-reference/consumer/mobile-sdks/ios/methods/oauth/authenticate-apple-id-token).

The current installation docs describe the newer Kotlin Multiplatform SDK as **public beta**, with `com.stytch.sdk:consumer-headless` on Android and the `StytchConsumerSDK` Swift package from `stytchauth/stytch-ios-sdk` on iOS. They explicitly link the older stable native SDKs. This distinction matters when selecting which SDK a custom Capacitor bridge would wrap. [Android installation](https://stytch.com/docs/api-reference/consumer/mobile-sdks/android/installation), [iOS installation](https://stytch.com/docs/api-reference/consumer/mobile-sdks/ios/installation).

### Missing Capacitor packaging

No maintained dedicated Stytch Capacitor wrapper was verified in the vendor docs or targeted searches. React Native support is not a Capacitor bridge. The concrete path is to wrap the stable native Stytch SDKs with a custom Capacitor plugin; this preserves their native authorization and session management. Another candidate is Capgo’s native provider-token acquisition plus Stytch’s token exchange, but calling SDK endpoints and coordinating session persistence from Cup remains integration work requiring validation. Capgo’s Apple source uses `ASAuthorizationAppleIDProvider`, `ASAuthorizationController.performRequests()`, and returns `identityToken`; its Android flow is documented as Credential Manager. [Capgo compatibility](https://capgo.app/docs/plugins/social-login/), [Capgo native Apple source](https://github.com/Cap-go/capacitor-social-login/blob/main/ios/Sources/SocialLoginPlugin/AppleProvider.swift).

**Verdict:** Stytch supports both required native flows and real SaaS sessions. Classify it as **custom Capacitor integration**, not unavailable and not ready to install. Capacitor 8 compatibility of a Stytch bridge and end-to-end session behavior remain untested.
