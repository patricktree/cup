# How Gemini 3.8 Flash-Lite TTS accepts a language or instructions

> Historical research, incorporated 2026-11-09. Built in [#220](https://github.com/patricktree/cup/pull/220); see [Narration language](../architecture/conversion.md#narration-language). The [listening prototype](narration-language-by-ear.md) confirmed by ear what the LLM judge found here, and a parallel run of the same question is [Gemini 3.8 TTS language](gemini-3.8-tts-language.md). Cup sends the style probed here, naming the narration language, on every segment of a speech policy 5 conversion, together with the language code, which the prototype found unnecessary for the byline but kept because it is the documented parameter and a malformed tag fails loudly. It validates tags itself and omits both fields for a tag outside the languages Google lists for Flash-Lite. The repository paths below describe the checkout before #220.

[Original investigation](https://github.com/patricktree/cup/blob/bec4463a476b116ceaabe9221cac9e3df656b2c3/docs/research/gemini-tts-language.md).

Completed on 2026-11-09 for [#191](https://github.com/patricktree/cup/issues/191), under the language-aware narration map [#190](https://github.com/patricktree/cup/issues/190). `gemini-3.8-flash-lite-tts` takes a BCP-47 code in `generation_config.speech_config[].language`, rejects malformed codes with HTTP 400, and silently accepts a well-formed code for a language it does not list. It rejects `system_instruction`. A `speech_metadata.style` annotation on the text part is not spoken, and in this small run it moved the byline's pronunciation towards German far more than the language code did. Cloudflare AI Gateway forwarded every field unchanged. Production configuration is unchanged.

## Method

The documentation was read first: the [Text-to-speech guide](https://ai.google.dev/gemini-api/docs/speech-generation), the [Flash-Lite TTS model page and migration guide](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts), the [Interactions API reference](https://ai.google.dev/api/interactions-api) (read as its [Markdown source](https://ai.google.dev/static/api/interactions-api.md.txt)), and Cloudflare's [Google AI Studio provider](https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/) and [universal endpoint](https://developers.cloudflare.com/ai-gateway/usage/universal/) pages. The ai.google.dev pages now redirect to aistudio.google.com/docs. The docs do not say which language values are valid, what an unsupported value does, whether a system instruction works for TTS, or whether the gateway passes these fields through, so paid probes filled those gaps.

`probe.mjs` sent 14 requests and `probe-followup.mjs` sent 3 more, all to `gemini-3.8-flash-lite-tts` with voice Charon through the gateway's universal endpoint with `provider: "google-ai-studio"` and `endpoint: "v1beta/interactions"`. They used `Api-Revision: 2026-05-20`, `audio/l16` at 24 kHz, no streaming, caching bypassed and payload logging off, which matches production apart from streaming. The texts are the derStandard byline "Gerald John, Alicia Prager, Sandra Schieder", a German sentence quoting an English sentence, and an English sentence naming Austrian people and the Bundeskanzleramt.

The audio was checked in three ways. Whisper large-v3-turbo on Workers AI transcribed each clip with language detection on (`evaluate.mjs`), which shows whether anything extra was spoken and which language the audio sounds like overall. Gemini 3.8 Flash described each clip on its own. Gemini 3.8 Flash also ranked four byline clips, without knowing which request made which, in four rotated orders so that position in the list could not bias the result (`rank.mjs`). The single-clip judge contradicted itself between clips, for example calling the no-language baseline German, so only the Whisper results and the rotated ranking are used below. One request per case and an LLM judge do not settle quality. The 17 MP3s are in the [experiment archive](gemini-tts-language.tar.xz) for listening.

The 14 successful requests produced 90.9 seconds of audio and 2,272 reported audio output tokens, about $0.014 at the published $6 per million audio tokens. The three rejected requests returned no audio.

## Language code

The Interactions API reference documents `language` ("The language of the speech") next to `voice` and `speaker` on each `SpeechConfig` entry, both in the single-speaker array and in `speakers` for multi-speaker requests. The TTS guide shows only `voice` and says the models "detect the input language automatically". Its supported-languages table lists language names without codes, and German is supported by both Flash and Flash-Lite TTS. Elsewhere in the guide, `language_code` appears only as a Voice Library filter that takes BCP-47 tags.

| `speech_config[0].language` | Result                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| omitted                     | HTTP 200                                                                                                                             |
| `de-DE`                     | HTTP 200                                                                                                                             |
| `de`                        | HTTP 200                                                                                                                             |
| `en-US`                     | HTTP 200 on German names                                                                                                             |
| `th-TH`                     | HTTP 200, although the docs list Thai for Flash TTS only                                                                             |
| `German`                    | HTTP 400 `invalid_request`: "Invalid language_code 'German' in speech_config. Provide a valid BCP-47 language code (e.g., 'en-US')." |
| `xx-XX`                     | HTTP 400 with the same message                                                                                                       |

So the API checks that the value is a known BCP-47 tag but not that this model supports the language. Bare language subtags such as `de` are accepted. The error message calls the field `language_code` even though the JSON field is `language`.

## Instructions apart from the spoken text

`system_instruction` exists on the interaction resource, but Flash-Lite TTS rejects it with HTTP 400 `invalid_request`: "Developer instruction is not enabled for this model".

The supported way to direct delivery is a `speech_metadata` annotation on the text content, `{"type": "speech_metadata", "style": "..."}`, whose `style` is documented as "Style instruction for the speech synthesis". The migration guide says that 3.8 "treats input text strictly as a verbatim transcript", that inline directions such as "Say cheerfully: Hello!" may be read aloud, and that sustained delivery instructions belong in `speech_metadata.style`. The annotation also has `start_index` and `end_index` byte offsets, which the TTS guide does not explain. The prompting guide adds: "Avoid putting age, gender, names, or permanent accent changes in `speech_metadata.style`". Google does not say why. The nearby advice is about keeping a voice consistent across generations, and the guide suggests a regional voice or Voice design for a permanent accent.

A style of "Read in German with standard German pronunciation." was not spoken in any of the four requests that carried it. Whisper heard only the byline or the sentence, and the byline clip stayed 4.2 seconds long against 4.2 seconds without a style.

## Effect on the byline and mixed-language text

| Byline request    | Whisper's detected language | Rank in the 4 blind rotations |
| ----------------- | --------------------------- | ----------------------------- |
| style annotation  | `de` (0.81)                 | 1st in 4 of 4                 |
| `language: de-DE` | `en` (0.99)                 | 2nd in 4 of 4                 |
| no language       | `en` (1.00)                 | 3rd or 4th                    |
| `language: en-US` | `en` (0.99)                 | 3rd or 4th                    |
| style and `de-DE` | `de` (0.99)                 | not ranked                    |

The judge called the style clip "authentic German/Austrian pronunciation" in every rotation. It described the `de-DE` clip as still mostly English, with vowels slightly closer to German. Taken together, the language code alone nudges the names but does not fix the reported symptom, and the style annotation, with or without the code, is what made Whisper hear German. Human listening has to confirm this before anything ships.

For the German sentence quoting English, Whisper detected German for every variant, with and without `de-DE`, and with and without the German style. Every transcript kept the English quote word for word. The judge said the English quote kept an English accent in the `de-DE` variants and grouped it with German delivery in the no-language and style-only variants, which is too inconsistent to rely on. Adding the German style made that clip slower: 10.9 seconds against 8.2 seconds without it. For the English sentence with Austrian names, `en-US` and `de-DE` both left Whisper hearing English, so a language code does not turn an English sentence into German.

The docs say nothing about text that mixes languages within one turn. Their one hint is that inline tags should stay in English even when the transcript is in another language.

## Cloudflare AI Gateway passthrough

Cloudflare's docs describe the universal endpoint's `query` as "the payload as the provider expects it in their official API" and document no reshaping, but they never mention the Interactions API or say that fields are forwarded unchanged. The probes show it. Google's own validation errors for `language` and `system_instruction` came back through the gateway, which only happens if the gateway forwarded those fields, and the style annotation changed the audio. The probes called the REST universal endpoint rather than the Worker binding `env.AI.gateway().run`. Both take the same `provider`, `endpoint`, `headers` and `query` shape, which production already uses to send `speech_config` and `response_format` through.

## Implications for language-aware narration

- Sending `language` as a BCP-47 code costs nothing and is accepted, but on this evidence it does not stop English-accented names. Cup has to validate codes itself: a malformed one fails the request with HTTP 400, which the synthesis client already classifies as permanent, and a well-formed code for a language Flash-Lite does not list is accepted without warning.
- A per-part `speech_metadata.style` naming the narration language is the strongest lever found here. It goes against Google's advice not to put accent changes in `style`, so the prototype should listen for drift across segments and for English passages being read with German phonetics.
- `system_instruction` is not an option for this model.
- How the model treats mixed-language text is undocumented. The quote test suggests it keeps an English passage in English inside German text, but this needs listening.
