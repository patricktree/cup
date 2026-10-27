# Architecture decisions

ADRs preserve decisions, alternatives, rationale, and consequences. Read them alongside the [current architecture](../architecture/README.md): accepted decisions can include work that has not been implemented.

| Decision                                                                    | Subject                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [0001](0001-use-a-canonical-synchronized-audiobook.md)                      | Canonical synchronized audiobook (superseded by 0005)                                            |
| [0002](0002-use-gemini-for-narration-content-selection.md)                  | Gemini through AI Gateway for narration content selection                                        |
| [0003](0003-charge-for-accessible-generated-narration.md)                   | Charging for accessible generated narration (partially superseded by 0004, 0006, 0007, and 0008) |
| [0004](0004-preserve-only-grants-during-drizzle-transition.md)              | Preserve only grants during the Drizzle transition                                               |
| [0005](0005-prepare-narration-before-player-controlled-synthesis.md)        | Preparation and player-controlled synthesis (partially superseded by 0006, 0007, and 0008)       |
| [0006](0006-synthesize-the-selected-unit-while-paused.md)                   | Synthesize the selected unit while paused (superseded by 0008)                                   |
| [0007](0007-require-active-grant-access-for-trial-audiobooks.md)            | Require active grant access for trial audiobooks                                                 |
| [0008](0008-synthesize-the-whole-narration-document.md)                     | Synthesize the whole narration document                                                          |
| [0009](0009-use-xstate-for-client-lifecycle-state-machines.md)              | XState for client lifecycle state machines                                                       |
| [0010](0010-tolerate-unknown-keys-at-the-listener-api.md)                   | Tolerant listener API, strict operator and internal inputs                                       |
| [0011](0011-offer-a-local-test-account-instead-of-google-in-development.md) | Local test account instead of Google sign-in in development                                      |

Each decision's frontmatter records its status. For a substantive reversal, add a superseding ADR and link it from the previous decision while retaining the old rationale. The [wiki schema](../agents/domain.md#record-decisions-and-evidence) describes how decisions, implementation gaps, and research relate.
