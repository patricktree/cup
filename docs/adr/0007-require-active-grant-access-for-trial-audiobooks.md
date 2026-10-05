---
status: accepted
---

# Require active grant access for trial audiobooks

Trial audiobook links previously allowed anyone with the link to read prepared text and replay completed audio, including after the conversion grant expired or was revoked. The user chose to restrict this access to holders of a session for the owning grant while that grant remains unexpired and unrevoked.

## Decision

- Require a valid session for the conversion's owning grant for audiobook JSON, segment state, and MP3 delivery. A link alone, another grant's session, or account sign-in alone does not authorize trial audiobook access.
- Consult the authoritative grant state on each request. Expiry and revocation block reading, replay, generation, and preparation retries through the audiobook API, including HEAD, range, and conditional media requests.
- Continue allowing reading and replay when duration is exhausted or fully reserved. New synthesis still requires sufficient available duration; replay does not consume allowance again.
- Keep grant inspection available to holders of an otherwise valid session so the client can explain grant expiry or revocation. This does not authorize reading its audiobooks or listing all its conversions.
- Send the grant cookie with browser and native media requests. Permit credentialed CORS only for the configured application origins, and serve audiobook responses with `private, no-store`.
- Retain stored artifacts and existing duration accounting. Already reserved synthesis may finish and reconcile normally. Expiry or revocation does not refund spent allowance or delete artifacts.

## Relationship to existing decisions

This partially supersedes [ADR 0003](0003-charge-for-accessible-generated-narration.md), [ADR 0005](0005-prepare-narration-before-player-controlled-synthesis.md), and [ADR 0006](0006-synthesize-the-selected-unit-while-paused.md) for trial reading and replay authorization, including continued access after expiry or revocation. Their preparation, synthesis triggers, duration accounting, and artifact retention decisions otherwise remain in effect.

## Consequences and verification

Sharing an audiobook link no longer shares access; recipients must first open the owning trial link to establish their own grant session. The rule applies to existing and new trial conversions because authorization is enforced at delivery rather than recorded as a per-conversion visibility flag. Account-owned audiobooks retain their existing ownership checks.

The Worker checks authorization before accessing audiobook storage. Tests cover missing, invalid, and foreign grant sessions; expired and revoked grant states; reading and media delivery with exhausted allowance; HEAD, byte ranges, and conditional ETags; credentialed CORS; and grant-validation failures. Worker integration tests verify that revoking a grant blocks subsequent audiobook and audio requests. Browser tests verify that trial holders can read and play while readers without the owning grant session cannot.

Access checks apply to subsequent requests and cannot retract text or audio already delivered or stop playback of bytes already buffered. Native cookie forwarding remains in place, but physical-device playback after this policy change requires device verification. See [authentication and authorization](../architecture/authentication.md#trial-access) for current request behavior.
