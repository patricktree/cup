# Terraform infrastructure

Run each root independently from the repository root.

| Root                             | Managed resources                                                                                                            | GCS state prefix |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [bootstrap](bootstrap/main.tf)   | Infrastructure project and state bucket                                                                                      | bootstrap        |
| [production](production/main.tf) | Existing cup-production GCP project and Terraform-created Supabase project; Cloudflare R2 bucket, DNS, Access and AI Gateway | production       |

Both roots use `cup-infrastructure-646301813623-tfstate` in Frankfurt (`europe-west3`).
The bootstrap project uses Cup Billing (`01EF28-40C66E-325909`).
Application teardown must never include the bootstrap root.

## Local use

Use Terraform 1.10 or newer, below 2.0, and Google Application Default Credentials with access to the bucket and managed resources.
Authenticate if needed:

```sh
gcloud auth application-default login
```

Initialize and review the relevant root:

```sh
terraform -chdir=terraform/bootstrap init
terraform -chdir=terraform/bootstrap plan
terraform -chdir=terraform/production init
node --env-file=terraform/.env.local --input-type=module -e 'import cp from "node:child_process"; process.exitCode = cp.spawnSync("terraform", ["-chdir=terraform/production", "plan"], {stdio: "inherit"}).status;'
```

Review a plan before applying it.
Keep provider lock files in version control; local Terraform directories, state, variable files and `.tfplan` files are ignored because they may contain credentials.
Use the `.tfplan` extension if saving plans.

## Bootstrap protection and adoption

The project and bucket were created before this configuration and imported on 2026-09-22.
Do not repeat these imports for the existing backend:

```sh
terraform -chdir=terraform/bootstrap import google_project.infrastructure cup-infrastructure
terraform -chdir=terraform/bootstrap import google_storage_bucket.terraform_state cup-infrastructure-646301813623-tfstate
```

Both resources have `prevent_destroy`; the project additionally uses the provider's `PREVENT` deletion policy and the bucket disallows forced deletion.
These Terraform protections depend on retaining the resource configuration and do not prevent deletion through the Google console or other tools.
The bucket has uniform IAM, enforced public access prevention, object versioning and seven-day soft deletion.
The GCS backend uses its native state locking; leave locking enabled.
Bootstrap imports successfully wrote remote state with default locking enabled, and the subsequent plan reported no changes.
A concurrent lock-contention test has not been performed.

## Application infrastructure and adoption

The production backend manages the existing cup-production GCP project, imported on 2026-09-22 with deletion protection.
The project currently has no organization parent and billing is disabled; adoption preserves those settings.
Terraform created the Supabase project named cup-production in Ireland (eu-west-1), with a five-minute JWT lifetime. Its site URL is <https://cup.audio/app>, applied on 2026-10-12 together with a replacement Google OAuth client secret. This project was created through Terraform; the Google Cloud projects and state bucket were adopted by importing existing resources.
The Google OAuth client remains outside Terraform state; Cloudflare resources are covered under [Cloudflare](#cloudflare). Terraform configures Supabase to use the manually created Google OAuth client. Application deployment and Cloudflare Worker secrets are managed separately with Wrangler; see [production configuration](../docs/production-configuration.md).
Supabase uses a management access token.
Keep secrets outside committed files.
Select and lock application providers when adding their resources, then review imports and plans before applying configuration changes.
Creating or changing the Google consumer OAuth client remains a manual operation.

Store infrastructure credentials in the ignored local file `terraform/.env.local`: `SUPABASE_ACCESS_TOKEN` for a Supabase personal access token and `CLOUDFLARE_API_TOKEN` (see [Cloudflare](#cloudflare)).
This file is not automatically loaded by Terraform; credentials must be passed to the provider process when continuing adoption.
The Worker keeps its existing sending-only key.

The generated Supabase database password is stored as `TF_VAR_supabase_database_password` in the same local credentials file and as a sensitive value in protected remote state.
Retain it for subsequent plans; sensitive marking suppresses terminal output but does not remove the value from state.
On 2026-10-02, the operator confirmed that the manually created Supabase project `oiehcntuiazvunyzngmi` had been deleted. It was never managed by this Terraform configuration; use the replacement project below.

The Terraform-created project reference is `evwjipxgacwotgbmqtla`, with URL <https://evwjipxgacwotgbmqtla.supabase.co>.
Configure social providers against callback <https://evwjipxgacwotgbmqtla.supabase.co/auth/v1/callback>. On 2026-10-01, the replacement management token successfully authenticated, the operator-verified Google OAuth secret was applied, and the subsequent production plan reported no changes. The bootstrap plan also reported no changes. These checks do not establish end-to-end sign-in or application deployment; the [Google sign-in configuration](#google-sign-in-configuration) records the later web sign-in check.

## Resend domain

`cup.audio` is the Resend domain the [deletion notices](../libs/registry/src/providers/resend-email.ts) are sent from (c9699e52-23e4-4fa7-a86c-b1a21f3e0d16). Manage it in the Resend dashboard. Keep it in Ireland (eu-west-1) with open and click tracking disabled and opportunistic TLS; the custom return path is left unspecified. Its DNS records are declared under [Cloudflare](#cloudflare). That the Worker's sending-only key may send from the domain is unverified.

Terraform managed the domain from 2026-10-12 through the community provider y0n0zawa/resend 1.0.1. On 2026-11-09 it was taken out of Terraform: the provider has one maintainer and an unaudited binary, and every plan ran it with all of this root's credentials, while it managed four settings and could not detect dashboard changes to tracking or TLS. A `removed` block took it out of state on 2026-11-09 without deleting it, and the provider then left the lock file. The full-access Resend key that only Terraform used is to be revoked; the Worker's sending-only key is unaffected.

The former sending domain `cup-audio.com` (f4b08144-5f30-4792-9491-3cac68af01b4) was deleted in the Resend dashboard on 2026-10-12 after the application moved to `cup.audio`, then removed from this configuration and from Terraform state.

## Cloudflare

The [Cloudflare configuration](production/cloudflare.tf) declares:

- The R2 bucket `create-audiobook-from-url-audio`, the Worker's `AUDIO_BUCKET`, in location `eeur`, with `prevent_destroy`.
- The hand-made DNS records of `cup.audio` and `cup-audio.com`: Resend's DKIM, `send` and `rsend` records, and on both zones a null MX, `v=spf1 -all` and a `p=reject` DMARC policy. The proxied AAAA records for the Worker's custom domains belong to Wrangler and stay out.
- The Access application and its reusable allow policy that protect `cup.audio/api/operator/*` (see the [operator runbook](../apps/operator/README.md#configure-cloudflare-access)). The output `operator_access_audience` is the AUD tag the Worker's `OPERATOR_ACCESS_AUDIENCE` must equal.
- The AI Gateway `default`, which development and production share, with a spend limit of 30 USD per rolling 30 days and `prevent_destroy`. The Google AI Studio key in its key store is not managed here. Cup wants no rate limit from the gateway, because Google limits the project and the application waits out its rejections ([ADR 0008](../docs/adr/0008-synthesize-the-whole-narration-document.md)). Provider 5.28.1 requires one, so the configuration sets a ceiling of 10,000 requests per sliding 60 seconds, ten times the 1,000 requests per minute Google allowed for speech on 2026-10-11. If Google's limit rises toward the ceiling, raise the ceiling too.

Terraform generated the configuration from the live resources on 2026-11-09. On the same day, import blocks adopted the 13 resources from `main`, and the apply set the gateway's previously unset rate limit to the ceiling above; the following plan reported no changes. Plan and apply only from an up-to-date `main`: a checkout whose configuration lacks resources held in state proposes destroying them, and `prevent_destroy` guards only the bucket and the gateway.

The provider reads `CLOUDFLARE_API_TOKEN`. Store a Cloudflare API token under that name in `terraform/.env.local`, with Zone Read and DNS Edit for `cup.audio` and `cup-audio.com`, and the account permissions Workers R2 Storage Edit, Access: Apps and Policies Edit, and AI Gateway Edit. Wrangler's OAuth login cannot serve as this token: it expires within hours and cannot request DNS, Access or AI Gateway permissions. Keep `CLOUDFLARE_API_KEY` out of the Terraform shell, because the provider treats that name as a global API key; the development token in `apps/cloudflare-worker/.env.local` uses it.

Not managed here:

- The bucket's default rule that aborts incomplete multipart uploads after seven days.
- The Resend records are copied from the Resend dashboard; when Resend changes them, update them here.

## Google sign-in configuration

The Google Web application OAuth client is created manually in the cup-production Google Auth Platform project.
Store its ID and secret in `terraform/.env.local` as `TF_VAR_google_web_client_id` and `TF_VAR_google_web_client_secret`.
Terraform configures Supabase's Google provider from these values, with nonce validation enabled.
The web client asks Supabase to return to the current page, so the redirect allow-list holds `https://cup.audio/app` and `https://cup.audio/app/**`; Supabase also accepts any URL with the site URL's scheme and host. Native Android exchanges a Google ID token directly and needs no redirect URL. The iOS app runs the same OAuth flow in a system browser sheet that returns to `audio.cup.app://auth/callback`, so the allow-list holds that URL too ([ADR 0019](../docs/adr/0019-sign-in-on-ios-through-supabase-oauth-in-a-system-browser-sheet.md)); it needs no Google client of its own.
Google must allow the new Supabase callback shown above and JavaScript origin <https://cup.audio>.
The Android OAuth client must be registered for package `audio.cup.app`.
On 2026-10-26, after the allow-list apply, the operator signed in with Google on <https://cup.audio/app> and was returned to the starting page. Native Android sign-in remains unverified.
The Supabase provider preserves masked OAuth secrets in state, so a no-change plan does not prove the secret works or detect an out-of-band secret change.
