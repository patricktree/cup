# Terraform infrastructure

Run each root independently from the repository root.

| Root                             | Managed resources                                                                         | GCS state prefix |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ---------------- |
| [bootstrap](bootstrap/main.tf)   | Infrastructure project and state bucket                                                   | bootstrap        |
| [production](production/main.tf) | Existing cup-production GCP project and Terraform-created Supabase project; Resend domain | production       |

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

## Remaining application adoption

The production backend manages the existing cup-production GCP project, imported on 2026-09-22 with deletion protection.
The project currently has no organization parent and billing is disabled; adoption preserves those settings.
Terraform creates a new Supabase project named cup-production in Ireland (eu-west-1), with a five-minute JWT lifetime and <https://cup-audio.com/app> as the site URL.
Google OAuth configuration and Cloudflare DNS records remain outside Terraform state.
Supabase uses a management access token; Resend uses a separate full-access management credential.
Keep secrets outside committed files.
Select and lock application providers when adding their resources, then review imports and plans before applying configuration changes.
Google consumer OAuth client setup remains a manual prerequisite under the current provider research.

Store infrastructure credentials in the ignored local file `terraform/.env.local`: `SUPABASE_ACCESS_TOKEN` for a Supabase personal access token and `RESEND_API_KEY` for a separate Resend full-access key.
This file is not automatically loaded by Terraform; credentials must be passed to the provider process when continuing adoption.
The Worker keeps its existing sending-only key.

The generated Supabase database password is stored as `TF_VAR_supabase_database_password` in the same local credentials file and as a sensitive value in protected remote state.
Retain it for subsequent plans; sensitive marking suppresses terminal output but does not remove the value from state.
The manually created Supabase project oiehcntuiazvunyzngmi remains outside Terraform pending retirement after replacement verification.

The Terraform-created project reference is `evwjipxgacwotgbmqtla`, with URL <https://evwjipxgacwotgbmqtla.supabase.co>.
Configure social providers against callback <https://evwjipxgacwotgbmqtla.supabase.co/auth/v1/callback>; provider credentials and native login validation are still pending.

## Resend domain

Imported cup-audio.com (f4b08144-5f30-4792-9491-3cac68af01b4) using y0n0zawa/resend 1.0.1.
The domain stays in Ireland with tracking disabled, opportunistic TLS and deletion protection.
Import omits tracking/TLS values, so an initial in-place update records those existing settings.
The provider preserves tracking/TLS state rather than reading live values, so plans cannot detect dashboard changes to those settings; inspect Resend directly when investigating drift.
The custom return path is left unspecified to preserve the existing domain; DNS records and sending API keys were not adopted or replaced.

## Google sign-in configuration

The Google Web application OAuth client is created manually in the cup-production Google Auth Platform project.
Store its ID and secret in `terraform/.env.local` as `TF_VAR_google_web_client_id` and `TF_VAR_google_web_client_secret`.
Terraform configures Supabase's Google provider from these values, with nonce validation enabled.
Google must allow the new Supabase callback shown above and JavaScript origin <https://cup-audio.com>.
Native Android/iOS client registration and end-to-end sign-in testing remain separate prerequisites.
The Supabase provider preserves masked OAuth secrets in state, so a no-change plan does not prove the secret works or detect an out-of-band secret change.
