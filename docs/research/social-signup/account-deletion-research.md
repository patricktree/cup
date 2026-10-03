# Account deletion and provider revocation

> Historical research, incorporated 2026-10-02. Provider prerequisites below are historical evidence, not Cup policy or proof of integration. Apple sign-in remains deferred. See [current account deletion](../../architecture/account-deletion.md) for recovery, fencing, erasure, and retention behavior. External claims retain their original research dates and have not been reverified during this migration.

[Original investigation](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/account-deletion-research.md).

Research date: 2026-09-21. Scope: factual prerequisites for Cup's deletion decision; this note does not settle product policy.

## Apple requirements

Apple requires apps supporting account creation to offer initiation of account deletion inside the app. Deactivation alone is insufficient. Confirmation and reauthentication are allowed without making deletion unnecessarily difficult. Deletion may take time, but the user must receive a timeframe and completion confirmation. Apps supporting Sign in with Apple should revoke the user's Apple tokens using its REST API. [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

Apple's revocation endpoint requires an Apple access token or refresh token, the matching App ID or Services ID, and a client-secret JWT signed with the developer's Sign in with Apple private key. An Apple identity token or Supabase session token is not a substitute. An authorization code can be exchanged for revocable tokens. [Apple token revocation API](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens).

Apple recommends transmitting the identity token and authorization code to the app server, validating/exchanging the code, and securely storing the resulting tokens. If credentials are unavailable, the app must still fulfil account deletion, then direct the user to manually revoke Apple access. Apple also documents native credential-revocation notifications and server notifications. [Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).

## What Supabase does

Supabase's native Apple examples establish a Supabase session through `signInWithIdToken` using an Apple identity token and nonce. They do not demonstrate capturing an Apple refresh token for later provider revocation. Its native-only sign-in statement that secret rotation is unnecessary must not be read as covering Cup's additional server-side Apple revocation workflow. [Supabase Apple integration](https://supabase.com/docs/guides/auth/social-login/auth-apple).

`auth.admin.deleteUser` is a server-only privileged operation; hard deletion is the default, while optional soft deletion is irreversible and retains identification through a hashed user ID. [Supabase deleteUser reference](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser).

Source inspection confirms `adminUserDelete` performs a database transaction with audit logging and hard or soft deletion. Its soft-delete branch explicitly removes sessions. There is no upstream Apple revocation call in this handler. Cup must not treat this operation as revoking Apple's authorization or deleting Cup's separate Cloudflare data. This is an implementation finding, not a guarantee about every future hosted release. [Supabase Auth source, inspected commit](https://github.com/supabase/auth/blob/2e9ce6c8e46532879ced1c6f9a7acdcde3815ea6/internal/api/admin.go).

## Google distinction

Google explicitly distinguishes revoking consent to share ID tokens from revoking OAuth access scopes. Its web API `google.accounts.id.revoke` handles the former; an OAuth revocation call does not replace it. Therefore an Apple-style token-revocation implementation cannot simply be generalized to all Google login paths. The correct native Capacitor/Credential Manager disconnect mechanism remains to be verified in the integration proof. [Google ID-token consent revocation](https://developers.google.com/identity/gsi/web/guides/revoke).

## Practical prerequisites and unresolved details

- Include Apple authorization-code capture and authenticated server exchange in the native proof, alongside sign-in itself. Validate that the exchanged Apple subject matches the account's linked Apple identity before storing credentials.
- Plan secure server custody of Apple revocation credentials, their associated client ID, and signing-key configuration. Cover both initial Apple signup and adding Apple to an existing account, regardless of which method is used when requesting deletion.
- Verify the web Apple flow's provider-token capture separately; the native ID-token path does not establish what a hosted OAuth callback exposes.
- Test revocation retries, missing credentials, already-revoked authorization, and deletion followed by re-registration. Do not make deleting Cup data depend indefinitely on Apple's availability.
- Define how Cup blocks a deleting account independently of its five-minute JWT lifetime, and prevents conversion/copy jobs from recreating deleted data. This is a Cup lifecycle design question, not a feature provided by Supabase user deletion.

The prerequisites above are engineering implications of the cited behavior. No provider registration, token exchange, deletion, or device test was performed during this research.
