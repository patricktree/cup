import { toLanguageSubtag } from "#src/language-tag.ts";

/**
 * The narration languages Whisper large v3 turbo supports, by their canonical BCP 47 language
 * subtag, each with the language code Whisper takes. These are the 68 of Cup's narration languages
 * (`narration-language-speakability.ts`) that Whisper's tokenizer lists; Whisper still names
 * Filipino, Norwegian Bokmål and Javanese by older codes. Cloudflare's model page names no
 * languages and Workers AI passes `language` through.
 * https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/tokenizer.py
 * and docs/research/overlap-cut-aligner.md on the branch research/overlap-cut-aligner
 * (patricktree/cup#316).
 */
const WHISPER_LANGUAGE_CODES = new Map([
  ["af", "af"], // Afrikaans
  ["am", "am"], // Amharic
  ["hy", "hy"], // Armenian
  ["as", "as"], // Assamese
  ["bn", "bn"], // Bangla
  ["eu", "eu"], // Basque
  ["be", "be"], // Belarusian
  ["bs", "bs"], // Bosnian
  ["bg", "bg"], // Bulgarian
  ["yue", "yue"], // Cantonese
  ["ca", "ca"], // Catalan
  ["zh", "zh"], // Chinese
  ["hr", "hr"], // Croatian
  ["cs", "cs"], // Czech
  ["da", "da"], // Danish
  ["nl", "nl"], // Dutch
  ["en", "en"], // English
  ["et", "et"], // Estonian
  ["fil", "tl"], // Filipino, Tagalog to Whisper
  ["fr", "fr"], // French
  ["gl", "gl"], // Galician
  ["ka", "ka"], // Georgian
  ["de", "de"], // German
  ["el", "el"], // Greek
  ["gu", "gu"], // Gujarati
  ["ht", "ht"], // Haitian Creole
  ["mn", "mn"], // Halh Mongolian
  ["ha", "ha"], // Hausa
  ["he", "he"], // Hebrew
  ["hi", "hi"], // Hindi
  ["hu", "hu"], // Hungarian
  ["is", "is"], // Icelandic
  ["id", "id"], // Indonesian
  ["fa", "fa"], // Persian
  ["it", "it"], // Italian
  ["ja", "ja"], // Japanese
  ["jv", "jw"], // Javanese
  ["kn", "kn"], // Kannada
  ["kk", "kk"], // Kazakh
  ["km", "km"], // Khmer
  ["ko", "ko"], // Korean
  ["lo", "lo"], // Lao
  ["ln", "ln"], // Lingala
  ["mk", "mk"], // Macedonian
  ["ml", "ml"], // Malayalam
  ["mt", "mt"], // Maltese
  ["mr", "mr"], // Marathi
  ["ne", "ne"], // Nepali
  ["az", "az"], // North Azerbaijani
  ["uz", "uz"], // Northern Uzbek
  ["nb", "no"], // Norwegian Bokmål, Norwegian to Whisper
  ["nn", "nn"], // Norwegian Nynorsk
  ["pl", "pl"], // Polish
  ["pt", "pt"], // Portuguese
  ["pa", "pa"], // Punjabi
  ["ro", "ro"], // Romanian
  ["ru", "ru"], // Russian
  ["sr", "sr"], // Serbian
  ["si", "si"], // Sinhala
  ["sk", "sk"], // Slovak
  ["es", "es"], // Spanish
  ["ar", "ar"], // Standard Arabic
  ["lv", "lv"], // Standard Latvian
  ["ms", "ms"], // Standard Malay
  ["ta", "ta"], // Tamil
  ["te", "te"], // Telugu
  ["tr", "tr"], // Turkish
  ["vi", "vi"], // Vietnamese
]);

/**
 * Returns the language code speech recognition hears a narration language by, judged by its
 * language subtag, or undefined when speech recognition does not support it.
 */
export function getSpeechRecognitionLanguage(narrationLanguage: string): string | undefined {
  return WHISPER_LANGUAGE_CODES.get(toLanguageSubtag(narrationLanguage));
}
