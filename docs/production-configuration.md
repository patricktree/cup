# Production configuration

Use this guide to supply the production Worker's configuration and the provider settings that Terraform does not manage, to find those it does, and to deploy. The [authentication](architecture/authentication.md) and [account deletion](architecture/account-deletion.md) pages explain the behavior this configuration enables. The [Terraform guide](../terraform/README.md) covers infrastructure state, the Supabase project, the Resend domain, and Supabase's Google provider. Apple sign-in and native iOS account support are deferred.

## Worker configuration

The [Worker configuration](../apps/cloudflare-worker/wrangler.jsonc) declares plain variables, including rate limits and the Supabase URL, and lists the required secrets. A [configuration test](../apps/cloudflare-worker/test/wrangler-config.test.ts) pins its custom domains, compatibility and asset settings, Durable Object and Workflow bindings, Durable Object migrations, required secrets, and observability settings, so changing them means updating that test deliberately. The API server's [environment contract](../libs/api-server/src/api-server-environment.ts) defines every value it reads. Supply secrets with Wrangler; they never belong in committed files or browser configuration.

| Secret                     | Purpose                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_PUBLISHABLE_KEY` | Browser SDK configuration; intentionally public                                                                                                                                                    |
| `SUPABASE_SECRET_KEY`      | Server-only identity administration and deletion                                                                                                                                                   |
| `GOOGLE_WEB_CLIENT_ID`     | Web OAuth client and native Android ID-token audience                                                                                                                                              |
| `RESEND_API_KEY`           | Sending-only transactional email access                                                                                                                                                            |
| `CLOUDFLARE_API_KEY`       | AI Gateway access for narration content selection                                                                                                                                                  |
| `SOURCE_PAGE_COOKIES_JSON` | Cookies sent when visiting source pages                                                                                                                                                            |
| `MEDIA_URL_SIGNING_KEY`    | Signs [signed media URLs](architecture/authentication.md#signed-media-url); a random value of at least 32 bytes, such as `openssl rand -base64 32`. Rotating it invalidates every outstanding URL. |

The Worker's Resend key is sending-only; Terraform uses a separate management key.

## Identity providers

Use Supabase project `evwjipxgacwotgbmqtla` exclusively. Terraform configures its Google provider, JWT lifetime, and redirect settings in the [Supabase configuration](../terraform/production/supabase.tf); see the [Google sign-in configuration](../terraform/README.md#google-sign-in-configuration). Configure ES256 JWT signing, which Terraform does not manage. Keep Google client secrets in Supabase and Terraform.

Register the Android OAuth client for package `audio.cup.app` and its signing certificate; a client registered for the former package `com.cup_audio.app` does not match.

## Email

Deletion notices go to the Resend API at the `RESEND_BASE_URL` variable, `https://api.resend.com`, from the Resend domain declared in the [Terraform guide](../terraform/README.md#resend-domain). Inspect notification outcomes with the [operator CLI](../apps/operator/README.md#list-account-deletions); provider acceptance is not proof of inbox delivery.

## Deploy

Deploys are manual: no CI workflow deploys, and pushing to `main` deploys nothing. Deploy from an up-to-date `main` after `pnpm validate` passes:

```sh
pnpm --filter '@cup/cloudflare-worker' run deploy
```

The script builds the web app and the Worker, then runs `wrangler deploy` with the [Worker configuration](../apps/cloudflare-worker/wrangler.jsonc), which sets `LOCAL_DEVELOPMENT` to `"false"`. Wrangler authenticates with the operator's own login (`wrangler login`). Keep the Cloudflare credentials from `apps/cloudflare-worker/.env.local` out of the deploying shell: that token covers development AI calls only, and Wrangler fails the asset upload with "No access to the specified resource" when it uses it. `wrangler deployments list`, run in `apps/cloudflare-worker`, shows the version now serving traffic.
