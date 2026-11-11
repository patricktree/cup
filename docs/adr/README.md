# Architecture decisions

ADRs preserve decisions, alternatives, rationale, and consequences. Read them alongside the [current architecture](../architecture/README.md): accepted decisions can include work that has not been implemented.

| Decision                                                                                                            | Subject                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [0001](0001-use-a-canonical-synchronized-audiobook.md)                                                              | Canonical synchronized audiobook (superseded by 0005, amended by 0014)                              |
| [0002](0002-use-gemini-for-narration-content-selection.md)                                                          | Gemini through AI Gateway for narration content selection                                           |
| [0003](0003-charge-for-accessible-generated-narration.md)                                                           | Charging for accessible generated narration (partially superseded by 0004, 0006, 0007, and 0008)    |
| [0004](0004-preserve-only-grants-during-drizzle-transition.md)                                                      | Preserve only grants during the Drizzle transition                                                  |
| [0005](0005-prepare-narration-before-player-controlled-synthesis.md)                                                | Preparation and player-controlled synthesis (partially superseded by 0006, 0007, and 0008)          |
| [0006](0006-synthesize-the-selected-unit-while-paused.md)                                                           | Synthesize the selected unit while paused (superseded by 0008)                                      |
| [0007](0007-require-active-grant-access-for-trial-audiobooks.md)                                                    | Require active grant access for trial audiobooks (partially superseded by 0013)                     |
| [0008](0008-synthesize-the-whole-narration-document.md)                                                             | Synthesize the whole narration document (partially superseded by 0011)                              |
| [0009](0009-use-xstate-for-client-lifecycle-state-machines.md)                                                      | XState for client lifecycle state machines (partially superseded by 0011)                           |
| [0010](0010-tolerate-unknown-keys-at-the-listener-api.md)                                                           | Tolerant listener API, strict operator and internal inputs                                          |
| [0011](0011-serve-one-narration-track-and-play-it-with-one-audio-element.md)                                        | One narration track played with one audio element (partially superseded by 0013)                    |
| [0012](0012-offer-a-local-test-account-instead-of-google-in-development.md)                                         | Local test account instead of Google sign-in in development                                         |
| [0013](0013-cache-cover-images-in-the-browser-for-a-day.md)                                                         | Cache cover images in the browser for a day                                                         |
| [0014](0014-cut-source-material-at-the-visible-headline-and-carry-the-source-subtitle-in-the-narration-document.md) | Cut source material at the visible headline and carry the source subtitle in the narration document |
| [0015](0015-fence-conversion-deletion-with-a-durable-marker-on-the-account-conversion-row.md)                       | Fence conversion deletion with a durable marker on the account conversion row                       |
| [0016](0016-keep-the-query-cache-for-the-page-lifetime-and-load-screens-in-route-loaders.md)                        | Keep the query cache for the page lifetime and load screens in route loaders                        |
| [0017](0017-keep-trial-links-out-of-the-mobile-apps.md)                                                             | Keep trial links out of the mobile apps                                                             |
| [0018](0018-test-the-mobile-apps-with-appium-through-webdriverio-on-host-owned-emulators-and-simulators.md)         | Test the mobile apps with Appium through WebdriverIO on host-owned emulators and simulators         |
| [0019](0019-sign-in-on-ios-through-supabase-oauth-in-a-system-browser-sheet.md)                                     | Sign in on iOS through Supabase OAuth in a system browser sheet                                     |
| [0020](0020-validate-in-three-local-gates-that-trust-the-turbo-cache.md)                                            | Validate in three local gates that trust the Turbo cache (partially superseded by 0021)             |
| [0021](0021-rerun-the-merge-gate-only-after-a-git-conflict.md)                                                      | Rerun the merge gate only after a git conflict                                                      |

Each decision's frontmatter records its status. For a substantive reversal, add a superseding ADR and link it from the previous decision while retaining the old rationale. The [wiki schema](../agents/domain.md#record-decisions-and-evidence) describes how decisions, implementation gaps, and research relate.
