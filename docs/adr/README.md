# Architecture decisions

ADRs preserve decisions, alternatives, rationale, and consequences. Read them alongside the [current architecture](../architecture/README.md): accepted decisions can include work that has not been implemented.

| Decision                                                             | Subject                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [0001](0001-use-a-canonical-synchronized-audiobook.md)               | Canonical synchronized audiobook (superseded by 0005)                      |
| [0002](0002-use-gemini-for-narration-content-selection.md)           | Gemini through AI Gateway for narration content selection                  |
| [0003](0003-charge-for-accessible-generated-narration.md)            | Charging for accessible generated narration                                |
| [0004](0004-preserve-only-grants-during-drizzle-transition.md)       | Preserve only grants during the Drizzle transition                         |
| [0005](0005-prepare-narration-before-player-controlled-synthesis.md) | Preparation and player-controlled synthesis (partially superseded by 0006) |
| [0006](0006-synthesize-the-selected-unit-while-paused.md)            | Synthesize the selected unit while paused                                  |

Each decision's frontmatter records its status. For a substantive reversal, add a superseding ADR and link it from the previous decision while retaining the old rationale. The [maintenance instructions](../agents/domain.md) describe how decisions, implementation gaps, and research relate.
