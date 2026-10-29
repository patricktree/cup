# Operator runbook

Use the operator CLI to create and manage production conversion grants and to inspect and manage accounts. New grants expire after 90 days and start with 120 minutes of audio duration allowance.

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

   - Hostname: `cup.audio`
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

The application runs at `https://cup.audio`. The former hostnames `cup-audio.com`, `www.cup-audio.com`, and `create-audiobook-from-url.patricktree.me`, and the alternate `www.cup.audio`, redirect every request to it; operator and other API clients must use `cup.audio` directly. Existing grants and their original trial credentials remain valid, but sessions belong to one hostname: readers reopen their original trial link or sign in again on `cup.audio`.

The Access application protects `/api/operator/*`, which does not include its parent `/api/operator/` path. Authenticate against an actual protected endpoint:

```sh
export CREATE_AUDIOBOOK_FROM_URL_OPERATOR_URL="https://cup.audio"
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

For a manual refund after permanent audio loss, inspect the grant and increase its total allowance by the duration being refunded. Changing the total does not reset spent duration. The grant records the difference from its previous total as an adjustment in its duration ledger.

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

## Manage accounts

### List accounts

List the Registry's identity-to-account mappings, oldest first:

```sh
pnpm operator account list
```

Filter by Registry phase (`provisioning`, `active`, or `deleting_identity`), and request up to 100 results:

```sh
pnpm operator account list --phase active --limit 100
```

Use the returned opaque cursor with `--cursor` to fetch the next page. Usage comes from the Registry's projection, which can lag the account by up to about a minute; an account shows `Usage: not yet projected` until the Registry first receives it. Use `account inspect` for the authoritative balance. The Registry does not record which sign-in provider created an account; look up the subject in Supabase for provider details.

### Inspect an account

Read the account's lifecycle state, balance, ledger totals, first history page, unresolved artifact writers, and conversion deletions still cleaning up:

```sh
pnpm operator account inspect "ACCOUNT_ID"
```

The history reports each conversion's status as account history does: a prepared conversion shows the [state of its audio](../../docs/architecture/conversion.md#whole-document-synthesis-and-accounting) next to its stored outcome. The history leaves out conversions that are being deleted. The account defines the shapes of this response in its [contracts](../../libs/accounts/src/domain/account-contracts.ts).

#### Conversion deletions

The "Conversion deletions" section after the JSON lists each conversion whose [deletion](#delete-a-conversion) is still cleaning up, with its `deleting_since_ms` and its age in minutes; `none` means no cleanup is owed. With `--json`, the same entries are in `conversionDeletions`. Cleanup normally finishes within a few minutes, after which the conversion leaves the list.

An entry that stays for long has stalled. If the `writers` list holds an unresolved writer whose prefix contains that conversion's ID, the writer never resolved, and the cleanup waits for it. Otherwise the registry or R2 is failing, and the account's 60-second alarm keeps retrying; check the Worker logs. See [conversion deletion](../../docs/architecture/conversion-deletion.md) for the order of the cleanup steps.

### Delete a conversion

Delete one conversion of an account, with its audiobook, artifacts, and listening position, while the rest of the account keeps working:

```sh
pnpm operator conversion delete "CONVERSION_ID" --yes
```

The deletion is irreversible and refunds nothing: spent duration stays spent, and only still-reserved duration is released. The command refuses to run without `--yes`. It prints the conversion ID and the owning account ID; cleanup continues in the background, and `pnpm operator account inspect "ACCOUNT_ID"` shows its progress under "Conversion deletions".

A repeat while the cleanup is still running succeeds again and changes nothing. Once the cleanup has finished, a repeat fails with `conversion-not-found`, which confirms the deletion. A trial conversion is refused with `conversion-not-account-owned`, and a conversion of an account that is itself being deleted with `account-unavailable`; account erasure removes that conversion anyway.

### Adjust an account allowance

Add or remove audio duration from an account's allowance with an audit reason:

```sh
pnpm operator account adjust-allowance "ACCOUNT_ID" \
  --minutes 60 \
  --reason "AUDIT_REASON"
```

Use a negative value such as `--minutes=-30` to reduce the allowance. Unlike a grant's total allowance, an account adjustment is a signed change recorded in the account's ledger together with its reason. A reduction cannot exceed the account's available duration, and only active accounts accept adjustments.

The command prints the request ID it used. If the result is uncertain, retry with the same request ID, amount, and reason so the adjustment is recorded only once:

```sh
pnpm operator account adjust-allowance "ACCOUNT_ID" \
  --minutes 60 \
  --reason "AUDIT_REASON" \
  --request-id "REQUEST_ID_FROM_OUTPUT"
```

Reusing a request ID with a different amount or reason is rejected.

### List account deletions

List unfinished deletion cleanup and completed deletion receipts. Each receipt records its notification outcomes:

```sh
pnpm operator account deletions
```

Provider acceptance of a notification is not proof of inbox delivery. For recovery deadlines, cleanup retries, unresolved writers, and retained receipts, see [account deletion](../../docs/architecture/account-deletion.md). For the relationship between trial and account conversions, see [trial access](../../docs/architecture/authentication.md#trial-access).

## Use machine-readable output

Place `--json` before the grant, account, or conversion command to write one JSON value to standard output:

```sh
pnpm operator --json grant list
```

On failure, the CLI exits with status 1 and writes `{ "error": { "code": "...", "message": "..." } }` to standard error. When the API refuses a request, `code` and `message` are the API's own, such as `account-unavailable`. A code this CLI does not know, for example from a newer server, and an API response without an error code report `operational-error` with the API's message. Failures without an API error, such as an unreachable service, report `operator-error`.

## Troubleshoot access

### `cloudflared` is unavailable

If the shell reports `command not found: cloudflared`, install it:

```sh
brew install cloudflared
```

### Cloudflare cannot find the Access application

If `cloudflared` reports `failed to find Access application`, confirm both of these conditions:

- The self-hosted Access application domain is `cup.audio/api/operator/*`.
- The `cloudflared` command targets a child endpoint such as `/api/operator/grants`, not the parent `/api/operator/` path.

### The Worker reports `operator-unauthorized`

A `401` response with code `operator-unauthorized` means the Worker could not validate the Access JWT or did not accept its email claim. Confirm that `OPERATOR_ACCESS_ISSUER`, `OPERATOR_ACCESS_AUDIENCE`, and `OPERATOR_EMAIL` match the Access application and that the updated Worker configuration is deployed.

Add `--debug` before `grant` to show redacted diagnostic details:

```sh
pnpm operator --debug grant list
```

[cloudflare-worker-access]: https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-a-specific-hostname-custom-domain-or-path
