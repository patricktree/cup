---
status: accepted
---

# Reserve 70 milliseconds of audio per narration-text character

[ADR 0003](0003-charge-for-accessible-generated-narration.md) estimated duration reservations at 80 milliseconds of audio per narration-text character, with a one-second minimum. Narration becomes 5% faster: each audio segment is time-stretched by ×1.05 after synthesis ([spec #275](https://github.com/patricktree/cup/issues/275)). At that pace running text measures about 62 milliseconds per character ([#266](https://github.com/patricktree/cup/issues/266)), so 80 milliseconds over-reserves by about 28%. Conversions near the end of a duration allowance are then refused as insufficient duration although their audio would fit, and the required duration shown with that refusal is inflated. The map [patricktree/cup#263](https://github.com/patricktree/cup/issues/263) decided the new rate in [#267](https://github.com/patricktree/cup/issues/267), and [#278](https://github.com/patricktree/cup/issues/278) implemented it.

## Decision

- **Estimate `max(1 s, characters × 70 ms)`.** A segment's reservation is 70 milliseconds per narration-text character, with the one-second minimum unchanged. 70 milliseconds keeps about 13% headroom over running text at the new pace.
- **One formula for every speech configuration and narration language.** The estimate does not follow the conversion's speech policy. Conversions prepared under the earlier policy keep today's pace, about 65–70 milliseconds per character on running text, which 70 milliseconds roughly covers, and they finish over time. English and German measured within 2% of each other, and no other language has been measured.
- **New reservations only.** Existing reservation rows keep the estimate stored with them, so the change needs no data migration. A segment reserved again after a release is a new reservation and uses the new rate.

This partially supersedes ADR 0003's 80-millisecond rate only. Reserving before synthesis, settling against generated audio duration as the charging authority, and capping overruns at the remaining allowance stand.

## Considered options

- **Keep 80 milliseconds.** Rejected: the over-reservation refuses conversions that fit and overstates the required duration.
- **A per-speech-configuration or per-language rate.** Rejected: the duration ledger would need the speech policy and narration language as new inputs, and the measured languages differ by less than the headroom.
- **A fixed amount per segment plus a per-character rate**, to cover short segments. Rejected: headings and names-only bylines measure about 100 milliseconds per character and can overrun their own reservation by a second or two, which settlement already absorbs from the available duration.

## Consequences

- Short segments such as headings and names-only bylines overrun their reservation more often. Settlement charges the overrun, capped at what remains of the allowance, as before.
- A conversion's whole-document estimate is lower, so fewer conversions near the end of an allowance are refused, and the required duration shown on a refusal is closer to what the audio needs.
- An account or grant holding reservations made before the release keeps those larger amounts until they settle or are released.
