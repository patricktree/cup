export { PRODUCTION_SELECTOR as selectNarrationContent } from "#src/production-narration-content-selection.ts";
export type {
  NarrationContentSelectionResult,
  SelectionChunkRunner,
  NarrationContentSelectionUsage,
  SelectionCostEstimateBasis,
} from "#src/narration-content-selection.ts";
export { PRODUCTION_DETECTOR as detectNarrationLanguage } from "#src/production-narration-language-detection.ts";
export type {
  DeclaredLanguage,
  NarrationLanguageDetectionInput,
  NarrationLanguageDetectionResult,
  NarrationLanguageDetectionRunner,
  NarrationLanguageFallbackReason,
} from "#src/narration-language-detection.ts";
