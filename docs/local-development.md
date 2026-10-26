# Local development

Use this guide to run the web application against local services. [Repository setup and validation](../AGENTS.md) covers preparing a checkout, and the [system overview](architecture/README.md#development-and-test-view) describes the development boundaries.

## Run local services

`pnpm dev:services` starts a local Supabase stack for authentication. You need Docker, pnpm, the existing Cloudflare development credentials, and a Google web OAuth client. Add `http://127.0.0.1:55321/auth/v1/callback` to that client's authorized redirect URIs. Local Google sign-in still contacts Google; Supabase itself runs locally.

Set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in your shell, or use the existing ignored `terraform/.env.local` entries `TF_VAR_google_web_client_id` and `TF_VAR_google_web_client_secret`.

```sh
pnpm dev:services
pnpm --filter @cup/cloudflare-worker dev
```

The [helper](../tooling/env-setup/src/dev-services.ts) generates an ignored signing key, starts the local Supabase stack, and writes its URL, API keys, Google client ID, and `LOCAL_DEVELOPMENT=true` into the ignored Worker environment file, keeping a copy of the previous environment to restore. The [local Supabase configuration](../supabase/config.toml) sets the ports and the short local JWT lifetime. Cup does not store application history or duration data in Supabase Postgres.

Stop the stack and restore the previous Worker environment:

```sh
pnpm dev:services stop
```

Restart the development server after either command.

## Development boundaries

Native apps always use the production API origin; local services configure web development only. The API server requires all bindings and authentication settings in its [environment contract](../libs/api-server/src/api-server-environment.ts); missing configuration is not a supported reduced-functionality mode.

The Worker configuration defaults `LOCAL_DEVELOPMENT` to `false`. With `true`, the API accepts requests to a localhost address, which carry no Cloudflare client IP, as one local client for ingress limits (see [ingress identity](../libs/api-server/src/http/ingress-identity.ts)); never enable it in production.
