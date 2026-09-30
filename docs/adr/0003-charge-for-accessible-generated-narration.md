---
status: accepted
---

# Charge for accessible generated narration

Use generated audio duration as the common usage unit for trial allowances and future paid plans, replacing conversion-count allowances because conversions vary in size and future narration may be generated progressively. Deduct allowance for successfully produced audio that the user can access, whether or not they play it; provider failures and automatic retries do not add charges. On cancellation, retain and charge completed, accessible audio segments while Cup initially absorbs the cost of the unfinished segment, prioritizing delivered value over recovering every provider expense.

## Consequences

- This deliberately replaces the current all-or-nothing conversion-slot policy: a failed conversion currently restores its slot, whereas accessible audio segments can consume allowance even when the whole audiobook never becomes ready.
- An immutable stored audio segment qualifies only when the user can access it; storage alone does not establish billable delivery.
- Measure generated audio duration in milliseconds using the completed encoded audio. The existing audio-segment production already measures duration, so this avoids introducing a text-to-duration estimate as the billing authority.
- The planned player will display narration text and HTML before progressively synthesizing narration audio. Completed audio segments must remain playable when the conversion stops or fails; a complete audiobook is not a prerequisite for accessing those segments.
- Cup absorbs source preparation and narration content selection costs in pricing and trial budgets. These steps do not consume the user's allowance; separate operational limits constrain repeated preparation attempts.
- Show the exact duration allowance and remaining balance in minutes and seconds. Only estimates of how much unsynthesized narration text that balance covers are approximate.
- Reserve estimated duration before synthesis and reconcile it against the actual duration when accessible audio is produced. Reservations prevent concurrent requests from spending the same available allowance.
- Estimate reservations using a fixed rate of 1 minute 20 seconds per 1,000 narration-text characters (80 milliseconds per character), with a one-second minimum. Accept occasional early blocking and unused allowance; the estimate does not guarantee that every remaining second can be spent. Actual generated audio duration remains the charging authority.
- Display only the available duration after subtracting active reservations, such as "8 minutes available". Do not expose a separate reserved-duration figure; reservations should resolve shortly. Reconcile the displayed available duration as reservations settle or are released.
- If completed segments exceed the remaining allowance, deliver them, cap total deductions at the remaining unspent allowance, and let Cup absorb the aggregate excess, including estimation overruns across concurrent segments. Reservations temporarily hold allowance rather than spend it, so reconciliation includes allowance held for the completed work. Balances do not become negative, and zero available duration blocks further synthesis. Use conservative estimates and measure overruns.
- Block a synthesis request if its full estimated duration cannot be reserved. Do not reserve only the remaining balance for a knowingly oversized request or split a narration block specifically to fit that balance. Preserve the unused allowance; courtesy overruns cover estimation errors.
- Do not introduce a fixed backend cap on concurrent segment generation for billing. Each request must obtain a duration reservation from the shared available balance; concurrent requests can reserve that balance for themselves. The Cup player controls speculative generation with a small lookahead, potentially using estimated text or audio length rather than a fixed count of narration blocks so short blocks still provide enough playback buffer. Exact player lookahead is deferred to the player rework.
- Pausing playback stops scheduling further synthesis but allows in-flight segments to finish; accessible results consume allowance. Explicit generation cancellation aborts unfinished synthesis, whose cost Cup absorbs.
- Replaying or retrieving existing audio segments, refreshing, and replaying requests do not consume allowance again. Explicit re-synthesis consumes allowance when its new audio becomes accessible. Different voices or other synthesis controls may never be exposed; if introduced, they do not exempt re-synthesis from charging.
- Default new trial grants to 120 minutes of shared duration allowance across all users and conversions authorized by that grant. Keep the allowance configurable per grant.
- Migrate all existing production trial grants to a fresh full duration allowance without deducting historical usage. Their conversion-slot allowances were never communicated to recipients, apart from possible error-message wording, so retaining a separate legacy allowance model would preserve no established customer promise. Preserve expiry, revocation, existing audiobook access, and free replay of earlier audio.
- Expiry and revocation immediately block new reservations but do not cancel already reserved synthesis. Let that work finish and reconcile normally; preserve completed-audio access under the existing grant-session policy.
- Temporary playback outages do not refund allowance; restore access. Permanent audio loss caused by Cup warrants a manual refund of deducted duration or free replacement synthesis. User deletion does not refund usage. Do not build an automated loss-refund mechanism for this change; handle any incident manually.
- Exact player lookahead, subscription design, purchasing credits, and payment processing are outside this design session.

Duration accounting applies to new synthesis; historical audio remains available without retrospective deductions.

The current conversion UI exposes complete audiobooks. Per-segment playback, generation cancellation, and an allowance balance display are deferred to the player rework; their proposed UI and API scaffolding are omitted from this implementation.
