---
status: accepted
---

# Offer a local test account instead of Google in development

Testing the web app on a phone used to need Google sign-in against the local Supabase stack. On 2026-10-27 that meant serving the stack over Tailscale and adding the tailnet callback URL to the Google web OAuth client by hand, a Google Cloud Console step for every developer machine and hostname. The user decided that local development should need no Google Cloud step at all, and chose a local-only sign-in that skips Google. This was decided in a Claude Code session on 2026-10-27 and implemented in the change that added `pnpm dev:services --tailnet`.

Before this change the Worker accepted any non-anonymous Supabase JWT ([`account-auth.ts` at 0fb4e71](https://github.com/patricktree/cup/blob/0fb4e71d/libs/api-server/src/http/account-auth.ts)). Account provisioning checks only that the Supabase user exists. Production was Google-only solely because production Supabase enables no other provider. A Google check (`googleAuthenticated`, plus `oauth`/`id_token` entries in the JWT's `amr` claim) gated only scheduling deletion and recovering the account. Google token revocation ran only when the client sent a Google provider token.

## Decision

1. **The Worker enforces the provider itself.** Account tokens must carry `app_metadata.provider` `google`. A Supabase project that enabled another provider would still not admit its identities to Cup.
2. **One local test account is the only exception.** It is an email and password identity that `pnpm dev:services` creates through the local Supabase admin API with a random password per start. The Worker accepts it only when `LOCAL_DEVELOPMENT` is `"true"` and the token's email equals the configured `LOCAL_TEST_ACCOUNT_EMAIL`. Other email identities in the local stack are refused, even though its email provider must allow sign-ups for password sign-in to work.
3. **The auth configuration advertises the test account, password included, only under the same condition.** The web app shows "Sign in with test account" only when the configuration offers it. Anyone who can reach the development server, for example over the tailnet, can therefore sign in as the test account.
4. **Fresh authentication counts only the identity's own method.** A password sign-in of the test account (`amr` method `password`) confirms deletion and recovery locally; for Google identities only `oauth` and `id_token` count, as before. The client confirms with the method the current session came from.
5. **The test account never triggers Google token revocation.** It has no Google token, and the server ignores a provider token sent for it.
6. **Google is optional locally.** Without a Google OAuth client, `pnpm dev:services` disables Supabase's Google provider and the auth configuration omits `googleWebClientId`, so the web app offers only the test account.

## Considered options

- Keep relying on the Supabase provider configuration. Rejected: the Worker's acceptance would then widen silently with any provider enabled in production Supabase.
- Accept any local email identity under `LOCAL_DEVELOPMENT`. Rejected: the local stack must allow email sign-ups, so anyone reaching it could create identities that become Cup accounts.
- Keep deletion and recovery Google-only. Rejected: deletion could then not be tested without Google.
- Use magic links or OTP. Rejected: the phone would need access to the local mailbox.
- Keep Google required in `pnpm dev:services`. Rejected: a new checkout would still need a Google OAuth client.

## Consequences

- `LOCAL_DEVELOPMENT=true` now also admits the test account, so it must never be set in production; the Worker configuration defaults it to `"false"`. The test account variables are declared there as empty strings because Wrangler's local runtime loads only declared keys.
- Production identities whose `app_metadata.provider` is not `google` lose access. None are expected, because production Supabase has only Google enabled; this was not verified against production data.
- `googleWebClientId` became optional in the auth configuration response. Installed Android apps parse it as required, which stays safe because the production Worker always sends it ([ADR 0010](0010-tolerate-unknown-keys-at-the-listener-api.md)).
