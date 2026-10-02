# Operate social signup and accounts

Cup supports Google sign-in on the web and Android, private conversion history, 30 minutes of welcome duration allowance, and account deletion. Apple sign-in, iOS account support, and payments are deferred. Account records and the append-only credit ledger live in SQLite Durable Objects; Supabase supplies identity, and R2 supplies artifacts.

Duration is recorded in integer milliseconds and displayed as minutes. Reserve estimated duration before synthesizing each segment, charge its actual encoded duration once, release unfinished reservations when a conversion terminates, and cap total charges at the allowance. Existing completed-segment charges survive a later failure. Account schema migration preserves existing history and archives the old conversion-unit ledger; migrated accounts receive the 30-minute duration grant once.

## Run local Supabase

You need Docker, pnpm, the existing Cloudflare development credentials, and a Google web OAuth client. Add `http://127.0.0.1:55321/auth/v1/callback` to that client's authorized redirect URIs. Local Google sign-in still contacts Google; Supabase itself runs locally.

Set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in your shell, or use the existing ignored `terraform/.env.local` entries `TF_VAR_google_web_client_id` and `TF_VAR_google_web_client_secret`.

```sh
pnpm auth:local
pnpm --filter @cup/cloudflare-worker dev
```

The helper generates an ignored ES256 signing key, starts the local Supabase stack, and writes its URL and API keys into the ignored Worker environment file. It preserves the previous environment in `supabase/.local/worker.env.local`. Local JWTs expire after five minutes. The API runs on port 55321, the database on 55322, and Studio on 55323. Cup does not store application history or credit data in Supabase Postgres.

Stop the stack and restore the previous Worker environment:

```sh
pnpm auth:local stop
```

Restart the development server after either command. Android continues to use the production API origin; this helper configures web development. Local fixture bypasses require `LOCAL_DEVELOPMENT=true`; never enable that flag in production.

## Configure production

The Worker configuration retains the existing trial stores and adds account/registry classes. Apply the additive Wrangler migrations through the normal deployment; do not delete or reset trial data.

| Configuration              | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `SUPABASE_URL`             | Auth issuer; configured in Wrangler                                   |
| `SUPABASE_PUBLISHABLE_KEY` | Browser SDK configuration; intentionally public                       |
| `SUPABASE_SECRET_KEY`      | Server-only identity administration and deletion                      |
| `GOOGLE_WEB_CLIENT_ID`     | Web OAuth client and native Android ID-token audience                 |
| `RESEND_API_KEY`           | Server-only transactional email access                                |
| `SIGNUP_IP_LIMIT`          | New accounts per hour/IP; default 10                                  |
| `CONVERSION_IP_LIMIT`      | Conversion requests per minute/IP; default 60                         |
| `CONVERSION_OWNER_LIMIT`   | New conversion requests per minute/account or trial grant; default 10 |

Supply the required values with the existing deployment secret mechanism. Keep Google client secrets in Supabase/Terraform, not browser configuration. Configure Google as the enabled social provider, ES256 JWT signing, a 300-second JWT lifetime, and the production redirect allow-list. Preserve the existing Android OAuth client, package name, and signing certificate registration.

Use the verified Resend domain and sender `Cup <no-reply@cup-audio.com>`. Scheduled and completed deletion messages have distinct immutable idempotency keys. Provider acceptance does not establish inbox delivery. Retries stop 23 hours after the first attempt, including restarts; expired ambiguous messages are not resent automatically.

Deletion and notification outcomes remain in the durable coordinator and are inspectable through the operator CLI. No external failure telemetry is configured, and user email is not emitted to diagnostic logs.

Production credentials were not verified in the initial implementation session. The saved Supabase management token returned 401, and no usable production public/admin auth key was available. That implementation was validated locally; it was not deployed.

## Inspect and retry

These commands use the existing Cloudflare Access operator authentication. Substitute actual UUIDs for the placeholders.

```sh
pnpm operator account inspect ACCOUNT_UUID
pnpm operator account deletions
```

Account inspection includes the current balance, ledger totals, the first history page, and unresolved artifact writers. Deletion inspection includes unfinished cleanup and completed receipts.

Trial conversions remain separate from accounts. Signing in does not copy, claim or import trial conversions, and account history contains only conversions started by that account. Losing access to earlier trial results after signing in is accepted. Existing trial links and source data are not deleted.

## Deletion and recovery

Deletion blocks account access immediately and stops playback. The user must freshly sign in with the same Google identity, then explicitly confirm recovery before the seven-day deadline. Signing in alone does not restore the account. Restoration preserves the duration allowance and history.

At the deadline, cleanup fences new writes and publication, waits for registered storage effects to drain, removes only that account's artifacts/routes/records, and deletes the exact old Supabase identity. Original trial conversions and other accounts remain separate. Cleanup retries with persisted backoff; jobs unfinished for 24 hours are marked overdue and continue retrying.

Successful tagged production writes can be reconciled after a lost acknowledgment. Effects with an uncertain outcome remain pending until confirmed. The operator can inspect them but cannot force a potentially active writer to disappear.

Completed deletion receipts contain only the agreed identifiers, timestamps, and outcomes, and expire after 90 days. They exclude email, tokens, and provider response bodies. Terminal notification payloads are redacted. Erased account objects retain only a constant erasure marker to fence late execution, without the deletion attempt identifier.

## Validate a change

Run `pnpm validate` for the free fast and extended checks. The suite includes real SQLite concurrency and replay tests, private authorization tests, browser session tests, and trial/account isolation tests. Build Android after web changes with the existing Android Studio JDK and SDK, then perform the single authenticated rollout smoke test when production configuration is available. Paid narration evals are separate.
