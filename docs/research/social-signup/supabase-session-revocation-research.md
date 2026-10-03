# Immediate Supabase session revocation

> Historical research, incorporated 2026-10-02. The per-request online session check recommended below is not implemented. Cup verifies JWTs locally; local sign-out does not immediately invalidate every copied JWT. Preserve this investigation as an alternative design, not a current guarantee. See [current authentication](../../architecture/authentication.md). External claims retain their original research dates and have not been reverified during this migration.

[Original investigation](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/supabase-session-revocation-research.md).

Researched 2026-09-18 against official documentation and Supabase Auth source at commit `8be26910bc1830a2af4dd760bc2901cdec4575c2`. No live tenant test was performed.

## Finding and recommended boundary

The inspected Auth server checks session existence on `GET /user`. Therefore a fresh, uncached `supabase.auth.getUser(accessToken)` on every protected Worker request can reject a logged-out session without waiting for JWT expiry. This is stronger than checking the JWT signature or calling a user-admin lookup. Cup should require a valid nonempty `session_id` for its account tokens, fail closed on validation failures, and perform a deployment acceptance test against its actual hosted project. Source inspection establishes implementation behavior, not a promise about every hosted deployment version.

Define immediate as: requests whose authorization checks occur after successful server-side logout cannot start using that session. A check that completed before logout, an already-started response, or a request racing logout is a separate in-flight-work question. Network transmission and transaction completion prevent interpreting immediate as the instant a person touches the logout button.

## What getUser actually checks

The router attaches `requireAuthentication` to `GET /user`. That middleware verifies the JWT, calls `maybeLoadUserOrSession`, and rejects banned users. The loader reads the user identified by `sub`; for a nonempty, nonzero `session_id`, it reads the corresponding session from the database and returns `session_not_found` if absent. `UserGet` additionally checks audience. This is explicitly a session lookup, not just signature checking or confirming that the account still exists. [Router](https://github.com/supabase/auth/blob/8be26910bc1830a2af4dd760bc2901cdec4575c2/internal/api/api.go), [authentication middleware](https://github.com/supabase/auth/blob/8be26910bc1830a2af4dd760bc2901cdec4575c2/internal/api/auth.go), [user handler](https://github.com/supabase/auth/blob/8be26910bc1830a2af4dd760bc2901cdec4575c2/internal/api/user.go).

The public `getUser(jwt)` API makes a network request to the Auth server. Use the presented access token explicitly, with server-side client persistence/refresh disabled, rather than sharing mutable signed-in client state across Worker requests. The latter is an implementation recommendation. Do not replace this with a cached successful result or purely local `getClaims`/JWT validation if immediate revocation is required. [Official getUser API](https://supabase.com/docs/reference/javascript/auth-getuser).

The normal `/user` authentication path inspected here does not run the full `Session.CheckValidity` timebox/inactivity evaluation. Session-row existence is sufficient for committed logout deletion; it should not be described as immediate enforcement of every possible session-expiry setting. Some other middleware, such as admin credential checks, separately performs validity checks. [Authentication source](https://github.com/supabase/auth/blob/8be26910bc1830a2af4dd760bc2901cdec4575c2/internal/api/auth.go), [admin middleware](https://github.com/supabase/auth/blob/8be26910bc1830a2af4dd760bc2901cdec4575c2/internal/api/middleware.go).

## Logout behavior and native social sessions

`POST /logout?scope=local` deletes the current session in a database transaction before returning HTTP 204. Global scope deletes all sessions for the user; others deletes all except the current session. This is direct deletion, not an asynchronous cleanup job. The models execute `DELETE ... WHERE id = ?` for local logout. [Logout handler](https://github.com/supabase/auth/blob/8be26910bc1830a2af4dd760bc2901cdec4575c2/internal/api/logout.go), [session models](https://github.com/supabase/auth/blob/8be26910bc1830a2af4dd760bc2901cdec4575c2/internal/models/sessions.go).

Supabase documents that signout revokes affected refresh tokens but existing access JWTs remain cryptographically valid until expiry. Its sessions guide explicitly recommends checking whether the JWT's `session_id` still has an `auth.sessions` row when post-logout rejection is needed. Every ordinary session has that claim. Timebox/inactivity cleanup is different and can be deferred; do not confuse it with logout's deletion. [Signout guide](https://supabase.com/docs/guides/auth/signout), [sessions guide](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).

Native Google/Apple login exchanged through `signInWithIdToken` goes through Auth's `IdTokenGrant`, which issues a refresh-token/session response. It is an ordinary Supabase session, not the upstream Google or Apple session. Logging out of the native identity provider alone does not revoke the Supabase session; invoke Supabase logout as well. [ID-token grant](https://github.com/supabase/auth/blob/8be26910bc1830a2af4dd760bc2901cdec4575c2/internal/api/token_oidc.go).

## Is direct auth.sessions access needed?

Not for the logout behavior verified above: the existing Auth API already performs that database lookup. No supported session-introspection admin endpoint was established in this research; `getUserById` is not a substitute for validating the requesting session.

If a deployment test disproves `/user` session checking, the documented row-existence approach remains possible through custom database access. A narrow server-only RPC can return a boolean for a verified session/user pair; alternatively a server-side Postgres connection can query the table. These are application-built mechanisms, not a Supabase turnkey introspection API. A genuinely private-schema function is not itself callable through the Data API unless wrapped by an exposed function. Keep `auth` unexposed and avoid returning session records. A privileged RPC needs tightly restricted EXECUTE grants, a safe `search_path`, and credentials held only by the Worker. Supabase documents functions, security-definer behavior, and execution privileges, but this exact RPC would require design and review. [Database functions](https://supabase.com/docs/guides/database/functions).

## Acceptance checks

- Sign in natively, retain the access JWT, and confirm a protected Worker request succeeds.
- Complete `signOut({ scope: 'local' })`, then replay that still-unexpired JWT immediately: the Worker must reject it, while another device's independent session continues working.
- Verify no Worker/CDN/application cache reuses positive authorization results; every protected media range request also checks authorization.
- Test provider outages and logout network failures. Clearing local UI/token storage without confirmed server revocation cannot promise immediate rejection of a copied JWT.
- Test concurrent refresh/logout and requests that begin before logout; establish the boundary at completed server revocation, without promising cancellation of previously authorized streams.
