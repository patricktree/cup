# Local development

Use this guide to run the web application against local services. [Repository setup and validation](../AGENTS.md) covers preparing a checkout, and the [system overview](architecture/README.md#development-and-test-view) describes the development boundaries.

## Run local services

`pnpm dev:services` starts a local Supabase stack for authentication. You need Docker, pnpm, and the existing Cloudflare development credentials.

```sh
pnpm dev:services
pnpm --filter @cup/cloudflare-worker dev
```

The [helper](../tooling/env-setup/src/dev-services.ts) generates an ignored signing key, starts the local Supabase stack, creates the local test account, and writes the stack's URL, API keys, the test account, a generated media URL signing key (kept when one is already set), and `LOCAL_DEVELOPMENT=true` into the ignored Worker environment file, keeping a copy of the previous environment to restore. The [local Supabase configuration](../supabase/config.toml) sets the ports and the short local JWT lifetime, and reads its host-dependent URLs from variables the helper sets. Run Supabase CLI commands through the helper, because the configuration does not parse without them. Cup does not store application history or duration data in Supabase Postgres.

Open `http://localhost:5173/app/` and choose **Sign in with test account**. The helper gives the test account a new random password on every start; the Worker hands it to the web app, so you never type it. [ADR 0012](adr/0012-offer-a-local-test-account-instead-of-google-in-development.md) records why this account exists and what the Worker accepts.

Stop the stack, any Tailscale serving it started, and restore the previous Worker environment:

```sh
pnpm dev:services stop
```

Restart the development server after either command. To switch between localhost and tailnet URLs, stop the stack first: a running stack keeps the URLs it started with, and the helper refuses to continue.

The development server refuses to start when the Worker environment points at a local or tailnet Supabase URL that does not answer its health check, for example when the stack was stopped or Docker restarted while `.env.local` still names it. Run `pnpm dev:services` again; the [Worker's Vite configuration](../apps/cloudflare-worker/vite.config.ts) holds the check.

### Optional: Google sign-in

Google sign-in is off unless you supply a Google web OAuth client. Set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in your shell, or use the ignored `terraform/.env.local` entries `TF_VAR_google_web_client_id` and `TF_VAR_google_web_client_secret`, and add `http://127.0.0.1:55321/auth/v1/callback` to the client's authorized redirect URIs. Local Google sign-in still contacts Google; Supabase itself runs locally.

## Test on a phone over Tailscale

With this Mac and the phone in the same tailnet, start the services with tailnet URLs:

```sh
pnpm dev:services --tailnet
pnpm --filter @cup/cloudflare-worker dev
```

The helper reads this machine's MagicDNS name from `tailscale status --json` and serves the web app (port 5173) and Supabase (port 55321) on it with `tailscale serve`, over HTTPS and only within the tailnet. It points Supabase's site URL, redirect URL, Google callback, and JWT issuer at those URLs, and the Worker's `SUPABASE_URL` at the tailnet Supabase URL. Open the printed `https://<machine>.<tailnet>.ts.net:5173/app/` on the phone and sign in with the test account; no Google Cloud Console step is needed. Google sign-in does not work over the tailnet unless you register the tailnet callback URL with your OAuth client.

The helper uses `/Applications/Tailscale.app/Contents/MacOS/Tailscale` on macOS when it exists, because a Homebrew `tailscale` can lag behind the app's daemon, and `tailscale` from `PATH` elsewhere. Set `TAILSCALE_CLI` to use another binary. The Vite configuration admits `*.ts.net` hosts, and conversions work through the tailnet hostname without further configuration: `tailscale serve` connects from `127.0.0.1`, which the local Worker runtime reports as the client IP for ingress limits.

## Development boundaries

Native apps always use the production API origin; local services configure web development only. The API server requires all bindings and authentication settings in its [environment contract](../libs/api-server/src/api-server-environment.ts); missing configuration is not a supported reduced-functionality mode, except that local development may run without Google sign-in.

The Worker configuration defaults `LOCAL_DEVELOPMENT` to `false`. With `true`, the API offers and accepts the local test account, and accepts requests to a localhost address, which carry no Cloudflare client IP, as one local client for ingress limits (see [ingress identity](../libs/api-server/src/http/ingress-identity.ts)); never enable it in production.
