# Authentication and authorization

Supabase establishes identity; Cup decides whether that identity may access a particular account or conversion. A valid access token does not override an account's deletion state or establish ownership of an audiobook.

## Sign-in and account provisioning

```mermaid
sequenceDiagram
    actor User
    participant Client as Web or Android client
    participant Google
    participant Auth as Supabase Auth
    participant API as Worker API
    participant Registry as Registry DO
    participant Account as Account DO
    User->>Client: Choose Google sign-in
    Client->>API: Load public auth configuration
    alt Web
        Client->>Auth: Start OAuth with PKCE
        Auth->>Google: Authenticate user
        Google-->>Auth: OAuth result
        Auth-->>Client: Redirect with authorization code
        Client->>Auth: Exchange code using verifier
    else Android
        Client->>Google: Native sign-in with hashed nonce
        Google-->>Client: Google ID token
        Client->>Auth: Exchange ID token and original nonce
    end
    Auth-->>Client: Supabase session
    Client->>API: Account request with bearer access token
    API->>API: Verify JWT signature and claims
    API->>Registry: Find identity mapping
    opt First use or unfinished provisioning
        Registry->>Auth: Verify identity still exists
        Registry->>Account: Initialize account and welcome allowance
        Registry->>Auth: Recheck identity before activation
    end
    API->>Account: Read account state and authorize operation
    Account-->>Client: Account response through API
```

On the web, the Supabase SDK persists the session and PKCE verifier in browser local storage and handles the OAuth return. Android uses native Google sign-in, exchanges its ID token with Supabase, and persists the Supabase session in secure storage. Android's Google request carries a hashed nonce while the exchange supplies the original nonce. Dedicated iOS account support is deferred; its adapter reuses web behavior and is not evidence of a validated native login flow.

The API verifies Supabase JWTs locally against the issuer's signing keys and validates audience, role, subject, and time claims. The HTTP authentication adapter verifies the token and supplies dependencies to the [account authentication use case](../../libs/api-server/src/use-cases/authenticate-account.ts), which resolves account ownership, provisions first-use identities, and resumes unfinished provisioning. First use provisions a separate Cup account ID through the registry. Provisioning is persisted and retried, and checks the provider identity before activation; ingress limits constrain new account creation. The account initializes its welcome duration allowance once. Subsequent operations consult Cup lifecycle state in addition to token validity.

Sources: [session lifecycle](../../apps/web-app/src/data-fetching/account-session.ts), [web adapter](../../apps/web-app/src/platform/account-auth.web.ts), [Android adapter](../../apps/web-app/src/platform/account-auth.android.ts), [iOS adapter](../../apps/web-app/src/platform/account-auth.ios.ts), [token verification](../../libs/api-server/src/account-auth.ts), and [registry provisioning](../../libs/registry/src/registry-durable-object.ts).

## Private media access

Audio elements and downloads need an authorization path beyond ordinary JSON requests. The client obtains a media session using its bearer token. The Worker issues an HTTP-only, same-site cookie scoped to `/api/files` for current and future file downloads and bounded by the token's expiry. Android also installs the session through its [native media bridge](../../apps/mobile-app/android/app/src/main/java/com/cup_audio/app/AccountMediaPlugin.java).

```mermaid
sequenceDiagram
    participant Client
    participant API as Worker API
    participant Registry as Registry DO
    participant Account as Account DO
    participant R2
    Client->>API: Create media session with bearer token
    API-->>Client: Media cookie scoped to /api/files
    Client->>API: Request /api/files/audiobooks/{id} artifact
    API->>Registry: Resolve conversion owner
    API->>API: Verify bearer token or media cookie
    API->>Account: Check active state and owning account
    API->>R2: Read authorized artifact
    R2-->>Client: Artifact through Worker
```

Audiobook JSON lives at `/api/audiobooks/{conversionId}` and requires bearer identity for private audiobooks. Audio, captions, and EPUB delivery routes live under `/api/files/audiobooks/{conversionId}` and accept bearer identity or the cookie fallback. Media-session creation at `/api/files/session` and account API operations require bearer identity. Private delivery checks the conversion's owner and current account state on requests. Scheduling deletion therefore blocks subsequent private requests even while a previously issued JWT remains unexpired. This is not a promise to retract bytes already downloaded by another client.

The client refreshes media authorization and pauses playback when authorization fails. Sign-out clears local identity and cached account data, stops and unloads media, and waits for outstanding cookie issuance before clearing media sessions so a late response cannot silently reestablish playback. Local sign-out is not an immediate global revocation mechanism for every existing JWT.

Sources: [media cookie and token handling](../../libs/api-server/src/account-auth.ts), [ownership middleware](../../libs/api-server/src/api-server.ts), [delivery](../../libs/api-server/src/serve-audiobook.ts), and [client session transitions](../../apps/web-app/src/data-fetching/account-session.ts).

## Trial access

A trial link carries a grant credential that is exchanged for a grant session. That session authorizes inspecting the grant and starting conversions while the grant permits it; it does not establish a personal account or authorize listing all grant conversions. Individual trial audiobook links provide unlisted access independently of the grant's expiry or revocation.

Account history contains conversions started by that account, and the client clears its remembered trial when switching into an account.

Sources: [grant-session handlers](../../libs/api-server/src/api-server.ts), [grant object](../../libs/conversion-grants/src/conversion-grant-durable-object.ts), and [client trial-link flow](../../apps/web-app/src/data-fetching/trial-link.ts).

## Operator access and lifecycle confirmation

The operator CLI authenticates through Cloudflare Access. The Worker validates the Access assertion against its configured issuer, audience, and operator identity before admitting operator routes. Development token handling is restricted to trusted development URLs. Operator authentication is separate from customer Google/Supabase sign-in.

Deletion and recovery require an additional one-use challenge and Google authentication after that challenge was issued. They also enforce request origin and content-type constraints. See [account deletion](account-deletion.md) for why ordinary sign-in does not restore access.

Sources: [operator guide](../../apps/operator/README.md), [Access verification and routing](../../libs/api-server/src/api-server.ts), [development access](../../libs/api-server/src/operator-access.ts), and [lifecycle handlers](../../libs/api-server/src/api-server.ts). Provider configuration and outstanding rollout verification belong in [signup operations](../social-signup-operations.md) and the [Terraform guide](../../terraform/README.md).

## Historical evidence and deferred work

The [auth service comparison](../research/social-signup/auth-saas-research.md) and [native sign-in investigation](../research/social-signup/native-social-sso-research.md) preserve the provider evaluation. The [session-revocation investigation](../research/social-signup/supabase-session-revocation-research.md) describes an online validation alternative; this checkout uses local JWT verification instead. The [Apple/iOS handoff](../research/social-signup/deferred-apple-ios.md) records deferred integration questions, not a validated flow or launch commitment.
