# PROTOTYPE verdict: narration language by ear

> Historical prototype verdict, incorporated 2026-11-09. Column 3 was built in [#220](https://github.com/patricktree/cup/pull/220) as decided; see [Narration language](../architecture/conversion.md#narration-language). The style names the language by its English name without its region, so `de-AT` gives "German", and it was heard only for German and English. The evidence it answers is in [Gemini TTS language and instructions](gemini-tts-language.md) and [Gemini 3.8 TTS language](gemini-3.8-tts-language.md). The clips, `index.html` and `synthesize.mjs` were not copied; they stay with the original.

[Original prototype](https://github.com/patricktree/cup/tree/0261981e31583034ee6bfbc06f57bf95a62da3ca/libs/audiobook-production/prototype-narration-language), verdict in `VERDICT.md`.

Throwaway branch, never merged. Answers [Prototype: hear the derStandard byline with each way of conveying the language](https://github.com/patricktree/cup/issues/193) for the map [Map: read each audiobook in its narration language](https://github.com/patricktree/cup/issues/190).

Rerun with `node synthesize.mjs` (paid, about 110 short Gemini 3.8 Flash Lite TTS calls), then open `index.html`. The clips listened to are in `out/`.

Listened to by Patrick on 2026-11-09:

| Column                                                    | German byline | English quote in German | German quote in English |
| --------------------------------------------------------- | ------------- | ----------------------- | ----------------------- |
| 1 Nothing (today)                                         | English ✗     | ✓                       | ✓                       |
| 2 Language code alone                                     | English ✗     | ✓                       | ✓                       |
| 3 Code + style "Read in L with standard L pronunciation." | ✓             | ✓                       | ✓                       |
| 4 Code + style naming the exception                       | ✓             | ✓                       | German sounds English ✗ |
| 5 Style alone                                             | ✓             | ✓                       | ✓                       |

The byline joined with the preceding lead sounded German in every column; the English article's German-name byline sounded English in every column, which is correct for English narration.

Verdict: column 3, `speech_config[0].language` plus a constant `speech_metadata.style` `"Read in <English name of the language> with standard <same> pronunciation."` on every segment. Passages in another language need no handling of their own.
