import type { PreparationPhase } from "@cup/listener-api.routes";

const LABEL_BY_PREPARATION_PHASE = {
  starting: "Starting",
  "reading-page": "Reading the page",
  "selecting-content": "Selecting narration content",
  "preparing-text": "Preparing the text",
} as const satisfies Record<PreparationPhase, string>;

/**
 * The label of a pending conversion's preparation phase. The listener client parses a phase it does
 * not know as absent, so a missing and an unknown phase both read "Preparing".
 */
export function toPreparationPhaseLabel(preparationPhase: PreparationPhase | undefined): string {
  return preparationPhase === undefined
    ? "Preparing"
    : LABEL_BY_PREPARATION_PHASE[preparationPhase];
}
