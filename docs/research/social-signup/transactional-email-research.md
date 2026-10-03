# Transactional email for Cup

> Historical research, incorporated 2026-10-02. The Cloudflare Email Sending recommendation below was superseded by the Resend integration. See [current account deletion](../../architecture/account-deletion.md) for notification behavior and the [operations guide](../../social-signup-operations.md) for configuration. External claims retain their original research dates and have not been reverified during this migration.

[Original investigation](https://github.com/patricktree/cup/blob/28971d5dca7915dd74ad629878aac9287ec7f7a3/.scratch/social-signup/transactional-email-research.md).

Research checked 2026-09-21 against primary vendor documentation. Scope: deletion-scheduled and deletion-completed notifications; no provisioning or sending performed.

## Recommendation

Prefer Cloudflare Email Sending, subject to accepting its beta status and confirming Cup's Workers Paid plan and domain onboarding. It has the smallest integration surface for Cup: an existing-platform binding, managed domain authentication, and a local simulator. Resend is the straightforward alternative if provider-side retry deduplication or avoiding the beta matters more. This recommendation is an engineering inference, not a user decision.

## Cloudflare Email Sending

Cloudflare now offers outbound transactional Email Sending in beta on Workers Paid. This is distinct from Email Routing: before onboarding a sending domain only verified destinations are allowed; afterward arbitrary recipients are allowed immediately. The initial daily quota is conservative and account-specific rather than a published fixed number. [Overview](https://developers.cloudflare.com/email-service/), [limits](https://developers.cloudflare.com/email-service/platform/limits/).

Workers Paid includes 3,000 outbound emails per account per month, followed by $0.35 per 1,000. Verified-destination sends are free. This allowance is part of a paid Workers subscription, not a standalone free sending plan. [Pricing](https://developers.cloudflare.com/email-service/platform/pricing/).

The sending domain must use Cloudflare DNS. Dashboard onboarding configures bounce handling and SPF/DKIM/DMARC records. Review those changes against any existing mail setup before applying them. Cup can send through a `send_email` binding without another vendor API credential. [Setup](https://developers.cloudflare.com/email-service/get-started/send-emails/), [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

Local `wrangler dev` simulates sending, logging and saving email content instead of delivering it. A remote binding sends actual mail and should only be enabled intentionally for delivery tests. [Local development](https://developers.cloudflare.com/email-service/local-development/sending/).

I found no documented provider idempotency key in the Workers or REST send interfaces. Do not infer exactly-once delivery from a stable Message-ID or Cup outbox. If the provider accepts a message but the response is lost, retrying can duplicate the notification. Cup should retain notification state and provider message IDs to suppress ordinary duplicate execution; the ambiguous-response case remains a tradeoff requiring acceptance or another provider. [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/).

## Resend alternative

Resend supports Workers, but adds account/domain onboarding and an API-key secret. Its free tier currently allows 3,000 emails/month, at most 100/day, with three domains. Pro is $20/month for 50,000, followed by $0.90/1,000. [Pricing](https://resend.com/pricing), [Cloudflare integration guide](https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/).

Resend supports idempotency keys retained for 24 hours. Reuse the same key and immutable payload for retries of one notification; use distinct keys for scheduled/completed messages and each deletion attempt. Stop automatic retries before the original key's retention boundary, with a margin, rather than assuming a delayed execution remains deduplicated after 24 hours. Cup still needs durable notification state for recovery. [Idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

Resend provides special test recipients for simulated delivery/bounce scenarios; these exercise its hosted API. For offline tests, use a Cup test adapter rather than send live email. [Test addresses](https://resend.dev/).

## Apple relay and deletion-specific checks

Either provider requires registering Cup's outbound domain/subdomain or address in Apple's private relay configuration and correctly authenticating outbound email. Apple matches authenticated source information against registered senders. A real Hide My Email delivery test is required once Apple account access is available. [Apple relay setup](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service).

Do not hard-code only the old relay domain: Apple now also documents `private.icloud.com`, alongside `privaterelay.appleid.com`. [Apple announcement](https://developer.apple.com/news/?id=1ptvdtcm).

Users can disable forwarding, so inbox receipt cannot be guaranteed. Verify completion-mail behavior around Apple authorization revocation during the native deletion proof; this research has not established whether that sequence leaves the relay usable. Do not delay deletion indefinitely for delivery or promise receipt. [Apple account-change notifications](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts), [Apple deletion technote](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).

Cup must preserve the minimum notification destination/payload outside the account data being erased until the completion notification is submitted or its retry window ends, then purge it under an explicit policy. This is a design implication of the agreed completion notification, not a vendor requirement. Provider acceptance and mailbox delivery should be distinct statuses; known permanent rejection should be flagged without repeatedly sending for 24 hours.
