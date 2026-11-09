export { PRODUCTION_SELECTOR as selectNarrationContent } from "#src/production-narration-content-selection.ts";
export type {
  NarrationContentSelectionResult,
  SelectionChunkRunner,
  NarrationContentSelectionUsage,
} from "#src/narration-content-selection.ts";
export type { CompletionCostEstimateBasis } from "#src/completion.ts";
export { PRODUCTION_DETECTOR as detectNarrationLanguage } from "#src/production-narration-language-detection.ts";
export type {
  NarrationLanguageDetectionInput,
  NarrationLanguageDetectionResult,
  NarrationLanguageDetectionRunner,
  NarrationLanguageFallbackReason,
} from "#src/narration-language-detection.ts";
