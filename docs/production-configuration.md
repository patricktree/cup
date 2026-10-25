# Production configuration

Use this guide to supply the production Worker's configuration and the provider settings that Terraform does not manage. The [authentication](architecture/authentication.md) and [account deletion](architecture/account-deletion.md) pages explain the behavior this configuration enables. The [Terraform guide](../terraform/README.md) covers infrastructure state, the Supabase project, the Resend domain, and Supabase's Google provider. Apple sign-in and native iOS account support are deferred.

## Worker configuration

The [Worker configuration](../apps/cloudflare-worker/wrangler.jsonc) declares plain variables, including rate limits and the Supabase URL, and lists the required secrets. A [configuration test](../apps/cloudflare-worker/test/wrangler-config.test.ts) pins its custom domains, compatibility and asset settings, Durable Object and Workflow bindings, Durable Object migrations, required secrets, and observability settings, so changing them means updating that test deliberately. The API server's [environment contract](../libs/api-server/src/api-server-environment.ts) defines every value it reads. Supply secrets with Wrangler; they never belong in committed files or browser configuration.

| Secret                     | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `SUPABASE_PUBLISHABLE_KEY` | Browser SDK configuration; intentionally public       |
| `SUPABASE_SECRET_KEY`      | Server-only identity administration and deletion      |
| `GOOGLE_WEB_CLIENT_ID`     | Web OAuth client and native Android ID-token audience |
| `RESEND_API_KEY`           | Sending-only transactional email access               |
| `CLOUDFLARE_API_KEY`       | AI Gateway access for narration content selection     |
| `SOURCE_PAGE_COOKIES_JSON` | Cookies sent when visiting source pages               |

The Worker's Resend key is sending-only; Terraform uses a separate management key.

## Identity providers

Use Supabase project `evwjipxgacwotgbmqtla` exclusively. Configure Google as the enabled social provider, ES256 JWT signing, a 300-second JWT lifetime, and the production redirect allow-list. Keep Google client secrets in Supabase and Terraform.

Register the Android OAuth client for package `audio.cup.app` and its signing certificate; a client registered for the former package `com.cup_audio.app` does not match.

## Email

The [deletion coordinator](../libs/registry/src/deletion-coordinator.ts) sends from the Resend domain declared in the [Terraform guide](../terraform/README.md#resend-domain). Inspect notification outcomes with the [operator CLI](../apps/operator/README.md#list-account-deletions); provider acceptance is not proof of inbox delivery.

## Pending rollout

This checkout's account support has not been verified in production. Remove this section once the rollout is complete.

1. Finish or terminate existing workflows. The [SQLite transition](../libs/conversion-grants/README.md#schemas-and-migration-baselines) preserves only existing grants: it discards old conversions and ownership routes and restores each grant's full configured allowance. Trial links and sessions keep their credentials, expiry, and revocation state; old audiobook links become unavailable. The transition does not clean up R2 files.
2. Do not delete or reset the trial namespaces, which contain the credentials being preserved. The Worker configuration renames `ConversionGrantRegistryDurableObject` to `RegistryDurableObject`; the [registry guide](../libs/registry/README.md#preserve-deployed-storage) describes how deployed storage is preserved.
3. Deploy the Worker. Rollback to the old handwritten-migration Worker is unsupported.
4. Build Android as described in the [mobile development guide](../apps/mobile-app/README.md#android-locally), then sign in once on web and once on Android against production.

On 2026-10-02, the production Worker `create-audiobook-from-url` received `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `GOOGLE_WEB_CLIENT_ID` through Wrangler. Both Supabase keys were verified against project `evwjipxgacwotgbmqtla`: the publishable key could read Auth settings with Google enabled, and the secret key could access the Auth admin users endpoint. Wrangler then listed all six required secrets; the existing `CLOUDFLARE_API_KEY`, `SOURCE_PAGE_COOKIES_JSON`, and `RESEND_API_KEY` were checked for presence, not validity. Uploading secrets and obtaining a no-change Terraform plan do not establish that this checkout has been deployed or that production sign-in works.
