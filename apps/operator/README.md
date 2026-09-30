# Operator runbook

Use the operator CLI to create and manage production conversion grants. Each grant expires after 90 days and starts with 120 minutes of audio duration allowance.

Run all commands from the repository root.

## Prerequisites

- Install the repository's Node.js and pnpm versions and its dependencies.
- Install `cloudflared` on macOS with `brew install cloudflared`.
- Use the Cloudflare identity configured as `OPERATOR_EMAIL` in `apps/cloudflare-worker/wrangler.jsonc`.
- Deploy the Worker with the Access variables described in [Configure Cloudflare Access](#configure-cloudflare-access).

## Configure Cloudflare Access

The public trial application and its API must remain accessible without a Cloudflare login. Protect only the operator API path.
Do not use the Worker's **Protect this Worker behind Access** action because it protects the whole Worker, including trial links.

1. In Cloudflare Zero Trust, go to **Access controls** > **Applications**.
2. Select **Create new application** > **Self-hosted and private**.
3. Select **Add public hostname**.
4. If `workers.dev` is unavailable in the **Domain** list, select **Switch to custom input**.
5. Enter these application values:

   - Hostname: `cup-audio.com`
   - Path: `/api/operator/*`
   - Protocol: **HTTPS**, if Cloudflare requests it

6. Add an **Allow** policy for the operator email address.
7. Create the application and record its team domain and application audience (AUD) tag.
8. In `apps/cloudflare-worker/wrangler.jsonc`, configure:

   - `OPERATOR_ACCESS_ISSUER` as `https://TEAM_NAME.cloudflareaccess.com`.
   - `OPERATOR_ACCESS_AUDIENCE` as the Access application's AUD tag.
   - `OPERATOR_EMAIL` as the exact email address allowed to operate grants.

9. Validate and deploy the Worker:

   ```sh
   pnpm validate
   pnpm --filter '@cup/cloudflare-worker' run deploy
   ```

Cloudflare documents this configuration under [Protect a specific hostname, Custom Domain, or path][cloudflare-worker-access].
The Worker validates the resulting Access JSON Web Token (JWT) before it runs an operator action.

## Authenticate the CLI

The application runs at `https://cup-audio.com`. The old hostname `create-audiobook-from-url.patricktree.me` only redirects trial links; operator and other API clients must use the new hostname. Existing grants and their original trial credentials remain valid, but browser and native sessions must be established again on the new domain.

The Access application protects `/api/operator/*`, which does not include its parent `/api/operator/` path. Authenticate against an actual protected endpoint:

```sh
export CREATE_AUDIOBOOK_FROM_URL_OPERATOR_URL="https://cup-audio.com"
export CREATE_AUDIOBOOK_FROM_URL_ACCESS_TOKEN="$(
  cloudflared access token \
    -app="${CREATE_AUDIOBOOK_FROM_URL_OPERATOR_URL}/api/operator/grants"
)"
```

`cloudflared` opens a browser authentication flow when it does not have a valid Access session. If needed, start that flow explicitly:

```sh
cloudflared access login \
  "${CREATE_AUDIOBOOK_FROM_URL_OPERATOR_URL}/api/operator/grants"
```

The explicit `CREATE_AUDIOBOOK_FROM_URL_ACCESS_TOKEN` is required because the CLI's automatic token lookup uses the unprotected root URL. Refresh this token when Cloudflare reports that the session has expired. Treat the token as sensitive and remove it from the shell after operator work:

```sh
unset CREATE_AUDIOBOOK_FROM_URL_ACCESS_TOKEN
```

## Create a trial link

Create a stable request ID before provisioning a grant. Keep the same ID if a network or service failure makes the result uncertain:

```sh
request_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"

pnpm operator grant create \
  --label "RECIPIENT_OR_PURPOSE" \
  --request-id "${request_id}"
```

`RECIPIENT_OR_PURPOSE` is an internal label used to identify the grant. The command returns the grant ID, expiry, request ID, and trial link.

The trial link contains a credential after the URL fragment (`#`). Store and share the complete link securely. The credential is displayed only when the grant is first issued and cannot be recovered later.

### Retry an uncertain creation

If creation fails without confirming the result, retry with the request ID from the error message and the same label:

```sh
pnpm operator grant create \
  --label "RECIPIENT_OR_PURPOSE" \
  --request-id "REQUEST_ID_FROM_ERROR"
```

The request ID makes provisioning idempotent. If the original request already issued a credential, the retry reports the existing grant but cannot return the trial link. If you did not capture that link, revoke the unusable grant and create another grant with a new request ID.

## Manage grants

### List grants

List the latest Registry snapshot:

```sh
pnpm operator grant list
```

Filter by label or projected state, and request up to 100 results:

```sh
pnpm operator grant list \
  --label "RECIPIENT_OR_PURPOSE" \
  --state open \
  --limit 100
```

Use the returned opaque cursor with `--cursor` to fetch the next page.

### Inspect a grant

Read the authoritative state, duration balances, and conversion count:

```sh
pnpm operator grant inspect "GRANT_ID"
```

### Change a duration allowance

Set the total audio duration allowance for an existing grant:

```sh
pnpm operator grant set-allowance "GRANT_ID" --minutes 120
pnpm operator grant inspect "GRANT_ID"
```

The total includes reserved and spent duration. The command rejects totals below their sum. Repeating the same total is safe. The original link, browser sessions, and expiry remain valid.

Newly created grants start with 120 minutes.

For a manual refund after permanent audio loss, inspect the grant and increase its total allowance by the duration being refunded. Changing the total does not reset spent duration.

### Revoke a grant

Revoke future use of a grant. This action is irreversible:

```sh
pnpm operator grant revoke "GRANT_ID" --yes
```

### Revoke a grant and invalidate sessions

Revoke a grant and invalidate its active browser sessions with an audit reason:

```sh
pnpm operator grant invalidate-sessions "GRANT_ID" \
  --reason "AUDIT_REASON" \
  --yes
```

### Migrate grants

Run the grant migration sweep after a deployment that requires it:

```sh
pnpm operator grant migrate --yes
```

The command exits with a nonzero status if any migration is incomplete.

## Use machine-readable output

Place `--json` before the grant command to write one JSON value to standard output:

```sh
pnpm operator --json grant list
```

## Troubleshoot access

### `cloudflared` is unavailable

If the shell reports `command not found: cloudflared`, install it:

```sh
brew install cloudflared
```

### Cloudflare cannot find the Access application

If `cloudflared` reports `failed to find Access application`, confirm both of these conditions:

- The self-hosted Access application domain is `cup-audio.com/api/operator/*`.
- The `cloudflared` command targets a child endpoint such as `/api/operator/grants`, not the parent `/api/operator/` path.

### The Worker reports `operator-unauthorized`

A `401` response with code `operator-unauthorized` means the Worker could not validate the Access JWT or did not accept its email claim. Confirm that `OPERATOR_ACCESS_ISSUER`, `OPERATOR_ACCESS_AUDIENCE`, and `OPERATOR_EMAIL` match the Access application and that the updated Worker configuration is deployed.

Add `--debug` before `grant` to show redacted diagnostic details:

```sh
pnpm operator --debug grant list
```

[cloudflare-worker-access]: https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-a-specific-hostname-custom-domain-or-path
