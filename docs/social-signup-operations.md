# Operate social signup and accounts

Use this guide to configure authentication and inspect account operations. The [authentication](architecture/authentication.md), [conversion](architecture/conversion.md), and [account-deletion](architecture/account-deletion.md) pages explain behavior and guarantees. Apple sign-in, native iOS account support, and payments are deferred.

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

Restart the development server after either command. Android continues to use the production API origin; this helper configures web development. The API server requires all bindings and authentication settings in its [environment contract](../libs/api-server/src/api-server-environment.ts); missing configuration is not a supported reduced-functionality mode. Wrangler defaults `LOCAL_DEVELOPMENT` to `false`. Local fixture bypasses require `LOCAL_DEVELOPMENT=true`; never enable that flag in production.

## Configure production

The Worker configuration adds the account class and renames the deployed `ConversionGrantRegistryDurableObject` to `RegistryDurableObject` using Cloudflare's `renamed_classes` migration. The registry retains its namespace and singleton name `registry`; its binding is now `REGISTRY`. The account-registry class was never deployed and is folded into this registry. The unified baseline includes account coordination tables and `conversion_owners`; the old `conversion_routes` table was never deployed. The [registry migration guide](../libs/registry/README.md) describes the rename. Separately, the [SQLite transition](../libs/conversion-grants/README.md#schemas-and-migration-baselines) deliberately preserves only the existing grants: it discards old conversions and ownership routes and restores each grant's full configured allowance. Trial links and sessions keep their credentials, expiry, and revocation state; old audiobook links become unavailable. Finish or terminate existing workflows before rollout. Do not delete or reset the trial namespaces, which contain the credentials being preserved. The transition does not clean up R2 files, and rollback to the old handwritten-migration Worker is unsupported.

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

Configure the Resend domain and sender used by the [deletion coordinator](../libs/registry/src/deletion-coordinator.ts). Inspect notification outcomes through the operator CLI; provider acceptance is not proof of inbox delivery.

On 2026-10-02, the production Worker `create-audiobook-from-url` received `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `GOOGLE_WEB_CLIENT_ID` through Wrangler. Both Supabase keys were verified against project `evwjipxgacwotgbmqtla`: the publishable key could read Auth settings with Google enabled, and the secret key could access the Auth admin users endpoint. Wrangler then listed all six required secrets from the [Worker configuration](../apps/cloudflare-worker/wrangler.jsonc), including the existing `CLOUDFLARE_API_KEY`, `SOURCE_PAGE_COOKIES_JSON`, and `RESEND_API_KEY`. The existing three credentials were checked for presence, not validity. The Worker retains its sending-only Resend key; Terraform uses a separate management key.

The operator confirmed on 2026-10-02 that the old Supabase project `oiehcntuiazvunyzngmi` had been deleted. Use `evwjipxgacwotgbmqtla` exclusively. The [Terraform guide](../terraform/README.md) records infrastructure adoption and the verified Google provider configuration. Uploading Worker secrets and obtaining a no-change Terraform plan do not establish that this checkout has been deployed or that production sign-in works. Application rollout and end-to-end web/Android sign-in verification remain outstanding.

## Inspect and retry

These commands use the existing Cloudflare Access operator authentication. Substitute actual UUIDs for the placeholders.

```sh
pnpm operator account inspect ACCOUNT_UUID
pnpm operator account deletions
```

Account inspection includes the current balance, ledger totals, the first history page, and unresolved artifact writers. Deletion inspection includes unfinished cleanup and completed receipts.

For recovery deadlines, cleanup retries, unresolved writers, and retained receipts, see [account deletion](architecture/account-deletion.md). For the relationship between trial and account conversions, see [trial access](architecture/authentication.md#trial-access).

## Validate a change

Run `pnpm validate` for the free fast and extended checks. The suite includes real SQLite concurrency and replay tests, private authorization tests, browser session tests, and trial/account isolation tests. Build Android after web changes with the existing Android Studio JDK and SDK, then perform the single authenticated rollout smoke test when production configuration is available. Paid narration evals are separate.
