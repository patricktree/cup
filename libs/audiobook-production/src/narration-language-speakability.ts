import { toLanguageSubtag } from "#src/language-tag.ts";
import { GEMINI_SPEECH_CONFIG, type SpeechConfig } from "#src/speech-synthesis-config.ts";

/**
 * The languages Gemini 3.8 Flash-Lite TTS supports, as canonical BCP 47 language subtags. Google
 * lists them by name only; several listed languages share one subtag (Chinese in Hans and Hant
 * script, Kashmiri in Arab and Deva script, Standard Arabic in Arab and Latn script, and Iranian
 * and Afghan Persian), and `Intl` canonicalizes some individual languages, such as Standard
 * Latvian, to their macrolanguage.
 * https://ai.google.dev/gemini-api/docs/speech-generation#languages, read on 2026-11-09.
 */
const GEMINI_FLASH_LITE_TTS_LANGUAGES = new Set([
  "ace", // Acehnese (Arab script)
  "af", // Afrikaans
  "ak", // Akan
  "am", // Amharic
  "hy", // Armenian
  "as", // Assamese
  "awa", // Awadhi
  "ban", // Balinese
  "bn", // Bangla
  "bjn", // Banjar (Latn script)
  "eu", // Basque
  "be", // Belarusian
  "bho", // Bhojpuri
  "bs", // Bosnian
  "bug", // Buginese
  "bg", // Bulgarian
  "yue", // Cantonese
  "ca", // Catalan
  "ceb", // Cebuano
  "ckb", // Central Kurdish
  "hne", // Chhattisgarhi
  "zh", // Chinese (Hans and Hant script)
  "hr", // Croatian
  "cs", // Czech
  "da", // Danish
  "nl", // Dutch
  "arz", // Egyptian Arabic
  "en", // English
  "et", // Estonian
  "fil", // Filipino
  "fr", // French
  "gl", // Galician
  "lg", // Ganda
  "ka", // Georgian
  "de", // German
  "el", // Greek
  "gu", // Gujarati
  "ht", // Haitian Creole
  "mn", // Halh Mongolian
  "ha", // Hausa
  "he", // Hebrew
  "hi", // Hindi
  "hu", // Hungarian
  "is", // Icelandic
  "ilo", // Iloko
  "id", // Indonesian
  "fa", // Iranian Persian and Persian (Afghanistan)
  "it", // Italian
  "ja", // Japanese
  "jv", // Javanese
  "kam", // Kamba
  "kn", // Kannada
  "ks", // Kashmiri (Arab and Deva script)
  "kk", // Kazakh
  "km", // Khmer
  "ki", // Kikuyu
  "rw", // Kinyarwanda
  "kg", // Kongo
  "ko", // Korean
  "ky", // Kyrgyz
  "lo", // Lao
  "ln", // Lingala
  "mk", // Macedonian
  "mag", // Magahi
  "mai", // Maithili
  "ml", // Malayalam
  "mt", // Maltese
  "mni", // Manipuri
  "mr", // Marathi
  "min", // Minangkabau (Arab script)
  "lus", // Mizo
  "ne", // Nepali (individual language)
  "fuv", // Nigerian Fulfulde
  "az", // North Azerbaijani
  "nso", // Northern Sotho
  "uz", // Northern Uzbek
  "nb", // Norwegian Bokmål
  "nn", // Norwegian Nynorsk
  "ny", // Nyanja
  "or", // Odia (individual language)
  "pl", // Polish
  "pt", // Portuguese
  "pa", // Punjabi
  "ro", // Romanian
  "ru", // Russian
  "sat", // Santali
  "sr", // Serbian
  "si", // Sinhala
  "sk", // Slovak
  "azb", // South Azerbaijani
  "pbt", // Southern Pashto
  "es", // Spanish
  "ar", // Standard Arabic (Arab and Latn script)
  "lv", // Standard Latvian
  "ms", // Standard Malay
  "ta", // Tamil
  "te", // Telugu
  "tr", // Turkish
  "vi", // Vietnamese
]);

/**
 * How a speech configuration treats a narration language: its model speaks the language, cannot
 * speak it, or ignores the narration language altogether, as ElevenLabs does.
 */
export type NarrationLanguageSupport = "speakable" | "unspeakable" | "ignored";

/**
 * Tells how the speech model of a speech configuration treats a narration language, judged by its
 * language subtag. A Gemini model without registered languages is a programmer error, so a model
 * change cannot silently turn every language unspeakable.
 */
export function getNarrationLanguageSupport(
  narrationLanguage: string,
  speechConfig: SpeechConfig,
): NarrationLanguageSupport {
  if (speechConfig.provider === "elevenlabs") {
    return "ignored";
  }

  if (speechConfig.model !== GEMINI_SPEECH_CONFIG.model) {
    throw new Error(
      `No speakable languages are registered for the Gemini speech model ${speechConfig.model}`,
    );
  }

  return GEMINI_FLASH_LITE_TTS_LANGUAGES.has(toLanguageSubtag(narrationLanguage))
    ? "speakable"
    : "unspeakable";
}
