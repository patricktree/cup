import { toLanguageSubtag } from "#src/language-tag.ts";

/**
 * The languages Whisper large v3 turbo supports, by their canonical BCP 47 language subtag, each
 * with the language code Whisper takes: the 100 languages of Whisper's tokenizer, plus Norwegian
 * Bokmål and Southern Pashto under the codes of Whisper's Norwegian and Pashto. Whisper still names
 * Filipino and Javanese by older codes. Whether Gemini's speech model gets a language tag
 * (`narration-language-speakability.ts`) has no bearing on this list. Close variants that Whisper
 * writes differently stay off it: Egyptian Arabic (`arz`), which Whisper writes as Modern Standard
 * Arabic, and South Azerbaijani (`azb`), written in Arabic script where Whisper writes Latin.
 * Cloudflare's model page names no languages and Workers AI passes `language` through.
 * https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/tokenizer.py
 * and docs/research/overlap-cut-aligner.md on the branch research/overlap-cut-aligner
 * (patricktree/cup#316).
 */
const WHISPER_LANGUAGE_CODES = new Map([
  ["af", "af"], // Afrikaans
  ["sq", "sq"], // Albanian
  ["am", "am"], // Amharic
  ["ar", "ar"], // Arabic, written as Modern Standard Arabic
  ["hy", "hy"], // Armenian
  ["as", "as"], // Assamese
  ["az", "az"], // Azerbaijani, written in Latin script
  ["bn", "bn"], // Bangla
  ["ba", "ba"], // Bashkir
  ["eu", "eu"], // Basque
  ["be", "be"], // Belarusian
  ["bs", "bs"], // Bosnian
  ["br", "br"], // Breton
  ["bg", "bg"], // Bulgarian
  ["my", "my"], // Burmese
  ["yue", "yue"], // Cantonese
  ["ca", "ca"], // Catalan
  ["zh", "zh"], // Chinese
  ["hr", "hr"], // Croatian
  ["cs", "cs"], // Czech
  ["da", "da"], // Danish
  ["nl", "nl"], // Dutch
  ["en", "en"], // English
  ["et", "et"], // Estonian
  ["fo", "fo"], // Faroese
  ["fil", "tl"], // Filipino; `Intl` also canonicalizes Whisper's `tl` to `fil`
  ["fi", "fi"], // Finnish
  ["fr", "fr"], // French
  ["gl", "gl"], // Galician
  ["ka", "ka"], // Georgian
  ["de", "de"], // German
  ["el", "el"], // Greek
  ["gu", "gu"], // Gujarati
  ["ht", "ht"], // Haitian Creole
  ["ha", "ha"], // Hausa
  ["haw", "haw"], // Hawaiian
  ["he", "he"], // Hebrew
  ["hi", "hi"], // Hindi
  ["hu", "hu"], // Hungarian
  ["is", "is"], // Icelandic
  ["id", "id"], // Indonesian
  ["it", "it"], // Italian
  ["ja", "ja"], // Japanese
  ["jv", "jw"], // Javanese; `Intl` also canonicalizes Whisper's `jw` to `jv`
  ["kn", "kn"], // Kannada
  ["kk", "kk"], // Kazakh
  ["km", "km"], // Khmer
  ["ko", "ko"], // Korean
  ["lo", "lo"], // Lao
  ["la", "la"], // Latin
  ["lv", "lv"], // Latvian
  ["ln", "ln"], // Lingala
  ["lt", "lt"], // Lithuanian
  ["lb", "lb"], // Luxembourgish
  ["mk", "mk"], // Macedonian
  ["mg", "mg"], // Malagasy
  ["ms", "ms"], // Malay
  ["ml", "ml"], // Malayalam
  ["mt", "mt"], // Maltese
  ["mi", "mi"], // Māori
  ["mr", "mr"], // Marathi
  ["mn", "mn"], // Mongolian
  ["ne", "ne"], // Nepali
  ["no", "no"], // Norwegian
  ["nb", "no"], // Norwegian Bokmål, one of the two written standards of Whisper's Norwegian
  ["nn", "nn"], // Norwegian Nynorsk
  ["oc", "oc"], // Occitan
  ["ps", "ps"], // Pashto
  // Southern Pashto, which `Intl` keeps apart from its macrolanguage, unlike Northern Pashto
  // (`pbu`), shares the Arabic script and written standard of Whisper's Pashto.
  ["pbt", "ps"],
  ["fa", "fa"], // Persian
  ["pl", "pl"], // Polish
  ["pt", "pt"], // Portuguese
  ["pa", "pa"], // Punjabi
  ["ro", "ro"], // Romanian
  ["ru", "ru"], // Russian
  ["sa", "sa"], // Sanskrit
  ["sr", "sr"], // Serbian
  ["sn", "sn"], // Shona
  ["sd", "sd"], // Sindhi
  ["si", "si"], // Sinhala
  ["sk", "sk"], // Slovak
  ["sl", "sl"], // Slovenian
  ["so", "so"], // Somali
  ["es", "es"], // Spanish
  ["su", "su"], // Sundanese
  ["sw", "sw"], // Swahili
  ["sv", "sv"], // Swedish
  ["tg", "tg"], // Tajik
  ["ta", "ta"], // Tamil
  ["tt", "tt"], // Tatar
  ["te", "te"], // Telugu
  ["th", "th"], // Thai
  ["bo", "bo"], // Tibetan
  ["tr", "tr"], // Turkish
  ["tk", "tk"], // Turkmen
  ["uk", "uk"], // Ukrainian
  ["ur", "ur"], // Urdu
  ["uz", "uz"], // Uzbek
  ["vi", "vi"], // Vietnamese
  ["cy", "cy"], // Welsh
  ["yi", "yi"], // Yiddish
  ["yo", "yo"], // Yoruba
]);

/**
 * Returns the language code speech recognition hears a narration language by, judged by its
 * language subtag, or undefined when speech recognition does not support it.
 */
export function getSpeechRecognitionLanguage(narrationLanguage: string): string | undefined {
  return WHISPER_LANGUAGE_CODES.get(toLanguageSubtag(narrationLanguage));
}
