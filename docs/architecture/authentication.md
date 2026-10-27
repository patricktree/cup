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
        Registry->>Auth: Verify identity exists (first use only)
        Registry->>Account: Initialize account and welcome allowance
        Registry->>Auth: Recheck identity before activation
    end
    API->>Account: Read account state and authorize operation
    Account-->>Client: Account response through API
```

On the web, the Supabase SDK persists the session and PKCE verifier in browser local storage and handles the OAuth return. Android uses native Google sign-in bound to a nonce, exchanges its ID token with Supabase, and persists the Supabase session in secure storage. Dedicated iOS account support is deferred; its adapter reuses web behavior and is not evidence of a validated native login flow.

The API verifies Supabase JWTs locally against the issuer's signing keys and their claims ([`account-auth.test.ts`](../../libs/api-server/test/account-auth.test.ts)); the [account authentication use case](../../libs/api-server/src/use-cases/authenticate-account.ts) then resolves the Cup account. First use provisions a separate Cup account ID through the registry. Provisioning is persisted and retried, and checks the provider identity before activation; ingress limits constrain new account creation. The account initializes its welcome duration allowance once; [`authenticate-account.test.ts`](../../libs/api-server/test/authenticate-account.test.ts) and the registry's [`accounts.test.ts`](../../libs/registry/test/accounts.test.ts) cover provisioning. Subsequent operations consult Cup lifecycle state in addition to token validity.

The web client sends its API requests through one [request module](../../apps/web-app/src/data-fetching/api-request.ts), where each call states whether it sends no account token, the signed-in account's token if there is one, or requires a signed-in account; a call for an account is refused once a different account is signed in ([`api-request.test.ts`](../../apps/web-app/src/data-fetching/api-request.test.ts)). Only the session machine's own plumbing, which loads the auth configuration, calls the API client directly; the [web app's lint configuration](../../apps/web-app/oxlint.config.ts) enforces both. Grant sessions travel as cookies regardless of this choice.

Sources: [web adapter](../../apps/web-app/src/platform/account-auth.web.ts), [Android adapter](../../apps/web-app/src/platform/account-auth.android.ts), [iOS adapter](../../apps/web-app/src/platform/account-auth.ios.ts), [token verification](../../libs/api-server/src/http/account-auth.ts), and [registry provisioning](../../libs/registry/src/durable-object/registry-durable-object.ts).

## Client session lifecycle

The web client models account auth as an [XState machine](../../apps/web-app/src/auth/account-session-machine.ts), following [ADR 0009](../adr/0009-use-xstate-for-client-lifecycle-state-machines.md). A [facade](../../apps/web-app/src/auth/account-session.ts) keeps the promise-based functions that routes, data fetching, and the player call, and derives the loading, signed-out, signed-in, or error state the UI shows.

```mermaid
stateDiagram-v2
    [*] --> uninitialized
    uninitialized --> initializing: INITIALIZE or SIGN_OUT
    initializing --> error: config or restore fails
    error --> initializing: INITIALIZE or SIGN_OUT
    initializing --> connected: session restored
    state connected {
        [*] --> ready
        [*] --> signingOut: SIGN_OUT queued during initialization
        state ready {
            [*] --> signedOut
            [*] --> signedIn
            signedOut --> signingIn: SIGN_IN
            signedIn --> signingIn: SIGN_IN
            signingIn --> signedIn: provider session
            signingIn --> signedOut: ended without a session
            signedOut --> signedIn: SESSION_CHANGED
        }
        ready --> ready: SESSION_CHANGED to another subject or none
        ready --> signingOut: SIGN_OUT
        signingOut --> ready: native sign-in ended, or a step failed
    }
```

Initialization loads the public auth configuration, creates the Supabase client, and restores the stored session. Every change of the signed-in subject stops playback, and signing into an account forgets the remembered trial. Replacing or removing a signed-in account also clears the query cache; the initial restoration does not, because route loaders may be awaiting it.

The machine's comments hold the transition rules. It guarantees the following; [`account-session.test.ts`](../../apps/web-app/src/auth/account-session.test.ts) checks the session-scope and sign-out rules:

- A session read never resolves to another account's session: starting a sign-in or sign-out, or replacing the signed-in subject, ends the read's scope.
- Only one OAuth flow runs at a time, because concurrent flows would overwrite each other's PKCE code verifier. A sign-in interrupted by a sign-out still settles with the provider's outcome, because the provider call cannot be recalled.
- Sign-out stops and unloads audio, signs out of Supabase locally, clears the stored session and the remembered trial, and ends the platform's own Google sign-in on Android. It completes locally even when Supabase could not confirm server revocation, and reports the failure; if initialization failed, the UI shows the auth error because the stored session could not be cleared.
- When account auth cannot initialize and no account is signed in, requests that accept either authorization continue with the grant session alone.

## Resuming a conversion after sign-in

When a reader submits a source URL for an account conversion, the client saves one pending request, the normalized source URL and an idempotency key, in `sessionStorage` before starting the conversion or asking the reader to sign in. This carries the submission through the OAuth redirect and reloads without putting it in the callback URL or keeping a long-lived draft; it is separate from the Supabase session and establishes neither identity nor authorization.

Once a signed-in session is available, the client resumes a stored submitted request automatically, reusing its idempotency key so retries refer to the same server request; submitting a different URL replaces the request with a new key. Cancelling sign-in keeps the request but marks it unsubmitted; a rate-limit response does the same, for an explicit retry; success clears it, and other failures leave it submitted for automatic resumption on a later mount. Response handlers check the current account and request key before changing stored state, so a late response cannot clear or disable a newer request ([`account-conversions.test.ts`](../../apps/web-app/src/data-fetching/account-conversions.test.ts)). Android's native sign-in shares this submission code.

Sources: [pending request storage](../../apps/web-app/src/data-fetching/account-conversion-storage.ts), [submission and resumption](../../apps/web-app/src/app/use-cases/account-conversions.ts), and [admission response handling](../../apps/web-app/src/data-fetching/account.ts).

## Private media access

Browser audio and image elements cannot send an `Authorization` header, so media under `/api/files` is authorized by a signed media URL instead. The audiobook response carries one for the narration track and one for the cover image, each issued to the principal the response was authorized for; the client plays and shows them as they are.

```mermaid
sequenceDiagram
    participant Client
    participant API as Worker API
    participant Owner as Account or grant DO
    participant R2
    Client->>API: Audiobook request with bearer token or grant cookie
    API-->>Client: Audiobook with signed track and cover image URLs
    Client->>API: Request /api/files/audiobooks/{id} media with its token
    API->>API: Verify the token's signature, expiry and audiobook
    API->>Owner: Check that the principal still has access
    API->>R2: Read authorized media
    R2-->>Client: Media through Worker
```

The [listener contracts](../../libs/listener-api.routes/src/hono-app.ts) define the routes. Audiobook JSON requires bearer identity for private audiobooks and the owning grant session for trial audiobooks. Media routes accept only a signed media URL: a bearer token, the grant cookie or any other cookie alone answers `401`. Account API operations require bearer identity. Private delivery checks the conversion's owner and current account state on every request ([`private-account-access.test.ts`](../../libs/api-server/test/private-account-access.test.ts)), so scheduling deletion blocks subsequent private requests even while a previously issued JWT remains unexpired. This is not a promise to retract bytes already downloaded by another client.

The web player loads the narration track for the signed-in user the audiobook was loaded for, and a change of that user unloads it ([`player-host.test.ts`](../../apps/web-app/src/app/player/player-host.test.ts)). Local sign-out is not a global revocation of existing JWTs.

### Signed media URL

A signed media URL authorizes media requests by its `token` query parameter alone. The token is stateless: an HMAC with the `MEDIA_URL_SIGNING_KEY` Worker secret over the audiobook (conversion) ID, the principal, and an expiry 24 hours after issuance. The principal is the account for a signed-in request and the grant for a trial request. Nothing is stored, so a token cannot be revoked individually; rotating the secret invalidates every outstanding URL. Every audiobook response issues a fresh token.

On every request, including HEAD, range and conditional requests, the Worker first checks the token's signature, expiry and audiobook ID against the route's `{conversionId}`; a missing, malformed, expired or foreign token answers `401` with `media-url-invalid`. It then runs the authoritative checks of the principal's own credentials: an active account that owns the conversion, or an unexpired, unrevoked grant that owns it. Scheduling account deletion and expiring or revoking a grant therefore block the next request, as [ADR 0007](../adr/0007-require-active-grant-access-for-trial-audiobooks.md) requires, and such denials answer as the equivalent audiobook request does. Responses stay `private, no-store`. The URL is a bearer credential for its lifetime: local sign-out does not invalidate a URL already issued, and anyone holding it can fetch that audiobook's media while the principal keeps access. [`signed-media-url.test.ts`](../../libs/api-server/test/signed-media-url.test.ts) and [`narration-track.test.ts`](../../libs/api-server/test/narration-track.test.ts) cover these rules.

Sources: [token signing and verification](../../libs/api-server/src/http/signed-media-url.ts), [ownership middleware](../../libs/api-server/src/api-server.ts), [delivery](../../libs/api-server/src/http/serve-audiobook.ts), and [client session transitions](../../apps/web-app/src/auth/account-session-machine.ts).

## Trial access

A trial link carries a grant credential that is exchanged for a grant session. That session authorizes inspecting the grant and starting conversions while the grant permits it; it does not establish a personal account or authorize listing all grant conversions. Reading prepared trial text requires a valid session for the owning grant, checked against the authoritative grant state before any artifact is loaded; replaying audio requires a [signed media URL](#signed-media-url) issued to the owning grant, checked against the same state on every request. Expired or revoked grants deny access; exhausted or fully reserved allowances still permit reading and replay. The audiobook's link alone, another grant's session, or account sign-in alone does not authorize access. [ADR 0007](../adr/0007-require-active-grant-access-for-trial-audiobooks.md) records this policy and [`trial-audiobook-access.test.ts`](../../libs/api-server/test/trial-audiobook-access.test.ts) enforces it, including that credentialed CORS admits only the configured application origins and that responses default to `private, no-store`.

Retrying preparation or synthesis also requires a session for the owning grant; preparation can proceed with exhausted duration, synthesis requires reservations covering the whole document. The HTTP-only [grant cookie](../../libs/conversion-grants/src/domain/grant-session.ts) authorizes JSON grant requests only; media routes do not accept it. Expiry and revocation cannot retract already downloaded text or audio. A missing or invalid grant session gets 401: the grant and conversion routes distinguish `grant-session-required` from `grant-session-invalid` and clear an invalid cookie, while audiobook and retry requests answer both with `grant-session-required`, and the trial page asks the reader to open the original trial link again.

Listening positions belong to the signed-in listener, including positions on trial audiobooks authorized by their owning grant. Anonymous listeners keep positions locally on their browser or native device. Account history contains conversions started by that account, and the client clears its remembered trial when switching into an account.

Sources: [grant-session handlers](../../libs/api-server/src/api-server.ts), [grant object](../../libs/conversion-grants/src/durable-object/conversion-grant-durable-object.ts), [client conversion-grant flow](../../apps/web-app/src/data-fetching/conversion-grant.ts) and its [error handling](../../apps/web-app/src/routes/trials.$grantId.tsx), and [client audiobook reads](../../apps/web-app/src/data-fetching/reader.ts).

## Operator access and lifecycle confirmation

The operator CLI authenticates through Cloudflare Access. The Worker validates the Access assertion against its configured issuer, audience, and operator identity before admitting operator routes. Development token handling is restricted to trusted development URLs. Operator authentication is separate from customer Google/Supabase sign-in. Operators can list accounts from the registry's identity mapping and record signed, idempotent allowance adjustments in an active account's ledger; neither action authenticates as, or changes the sign-in identity of, the account.

Deletion and recovery additionally require a one-use challenge, fresh Google authentication, and request origin and content-type checks; see [account deletion](account-deletion.md#confirmation-and-recovery).

Sources: [operator guide](../../apps/operator/README.md), [Access verification, routing, and lifecycle handlers](../../libs/api-server/src/api-server.ts), and [development access](../../libs/api-server/src/http/operator-access.ts). Provider configuration belongs in [production configuration](../production-configuration.md) and the [Terraform guide](../../terraform/README.md).

## Historical evidence and deferred work

The [auth service comparison](../research/social-signup/auth-saas-research.md) and [native sign-in investigation](../research/social-signup/native-social-sso-research.md) preserve the provider evaluation. The [session-revocation investigation](../research/social-signup/supabase-session-revocation-research.md) describes an online validation alternative; this checkout uses local JWT verification instead. The [Apple/iOS handoff](../research/social-signup/deferred-apple-ios.md) records deferred integration questions, not a validated flow or launch commitment.
