# How Gemini 3.8 Flash-Lite TTS accepts a language or instructions

> Historical research, incorporated 2026-11-09. Built in [#220](https://github.com/patricktree/cup/pull/220); see [Narration language](../architecture/conversion.md#narration-language). A second run of the same question, [Gemini TTS language and instructions](gemini-tts-language.md), and the [listening prototype](narration-language-by-ear.md) settled what this note left open. Cup differs from the recommendations below: it sends the language code together with a constant style "Read in German with standard German pronunciation." (for German) rather than the style text probed here, it keeps a names-only segment on its own instead of joining it with neighbouring text, and instead of mapping languages it omits both fields for any tag outside the languages Google lists for Flash-Lite. The repository paths below describe the checkout before #220.

[Original investigation](https://github.com/patricktree/cup/blob/bec4463a476b116ceaabe9221cac9e3df656b2c3/docs/research/gemini-3.8-tts-language.md).

Researched on 2026-11-09 for [#191](https://github.com/patricktree/cup/issues/191), part of the map [#190: read each audiobook in its narration language](https://github.com/patricktree/cup/issues/190). The question is how `gemini-3.8-flash-lite-tts`, called through the Interactions API over Cloudflare AI Gateway as in `libs/audiobook-production/src/synthesize-gemini-audio.ts`, can be told which language to speak. The symptom is that derStandard bylines such as "Gerald John, Alicia Prager, Sandra Schieder" sit in a segment of their own and are read with an English accent.

**Short answer:** the request does accept a BCP-47 code in `generation_config.speech_config[].language`, and Google validates it. But in these probes `de-DE`, `de-AT` and `de` did not make the German byline sound German. A `speech_metadata.style` annotation asking for German pronunciation did shift it toward German, though not reliably. `system_instruction` is rejected for this model. Cup should send the language code anyway (it is cheap, provider-neutral and does have an effect, as `sv-SE` showed), but it should not count on the code alone to fix the byline. A listening test of style text and of segment context is the next step, which belongs to the prototype ticket.

## Sources

- Google, [Gemini 3.8 Flash-Lite TTS model page and migration guide](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts) (Markdown at `https://aistudio.google.com/docs/models/gemini-3.8-flash-lite-tts.md`).
- Google, [Text-to-speech guide](https://ai.google.dev/gemini-api/docs/speech-generation), especially [controlling style](https://ai.google.dev/gemini-api/docs/speech-generation#controllable), [supported languages](https://ai.google.dev/gemini-api/docs/speech-generation#languages), the [prompting guide](https://ai.google.dev/gemini-api/docs/speech-generation#prompting-guide) and the [Extended Voice Library](https://ai.google.dev/gemini-api/docs/speech-generation#voice-library).
- Google, [Interactions API reference: create interaction](https://aistudio.google.com/api-reference/interactions-api/create-interaction.md) and [generateContent reference](https://aistudio.google.com/api-reference/generate-content/generate-content.md).
- Cloudflare, [AI Gateway Google AI Studio provider](https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/) and [Universal Endpoint](https://developers.cloudflare.com/ai-gateway/usage/universal/), the request shape that the Workers binding's `ai.gateway(id).run()` uses.
- Paid probes run for this note through Cloudflare AI Gateway (see [Probes](#probes)).

## Is there a language-code parameter?

Yes, `language` on each `speech_config` entry. The Interactions API reference lists `generation_config` speech configuration as an array of `SpeechConfig` objects (or a `SpeakerConfig` with `speakers`), each with `voice`, `language` ("The language of the speech.") and `speaker` ([create interaction](https://aistudio.google.com/api-reference/interactions-api/create-interaction.md)). The reference renders the field name as `structured_speech_config`, but the TTS guide's REST examples and Cup's working code both send `generation_config.speech_config`, and the probes below confirm that `speech_config[].language` is read. The reference gives no list of valid values.

The legacy generateContent `SpeechConfig.languageCode` has a fixed list of 30 BCP-47 tags, `de-DE` among them, but that list describes the older API and is not documented for the Interactions API ([generateContent reference](https://aistudio.google.com/api-reference/generate-content/generate-content.md)).

What the probes showed about values:

| `language` value                           | Result                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `zz-ZZ`                                    | HTTP 400, `invalid_request`: "Invalid language_code 'zz-ZZ' in speech_config. Provide a valid BCP-47 language code (e.g., 'en-US')." |
| `German`                                   | HTTP 400 with the same message: language names are rejected.                                                                         |
| `de-DE`, `de-AT`, `de`                     | HTTP 200: region subtags and bare language subtags are accepted.                                                                     |
| `sv-SE`                                    | HTTP 200, although Swedish is listed for Flash TTS only, not Flash-Lite. The audio changed (Whisper heard Swedish).                  |
| `eo` (Esperanto, listed for neither model) | HTTP 200; Whisper still heard English.                                                                                               |

So the API checks that the value is a well-formed BCP-47 tag but does not reject a well-formed code for a language the model does not list. The fallback for an unsupported language is therefore Cup's own decision; the API will not report one.

## Can instructions be sent separately from the spoken text?

- **`speech_metadata.style`: yes, documented.** Gemini 3.8 TTS treats `text` "strictly as a verbatim transcript" and moves delivery directions into a `speech_metadata` annotation with `style` (and `speaker`) on each text content block ([migration guide](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts#migration-guide), [controlling style](https://ai.google.dev/gemini-api/docs/speech-generation#controllable)). The reference's `SpeechAnnotation` also carries `start_index` and `end_index`, documented only generically as the segment the annotation applies to, in bytes ([create interaction](https://aistudio.google.com/api-reference/interactions-api/create-interaction.md)). In the probes the style text was not spoken: audio length stayed at the baseline's (4.4 to 4.6 s against 4.6 s), the transcripts contain only the names, and the provider reported the same 11 input tokens as with no style. The guide warns against putting "permanent accent changes" in `style` and recommends a regional voice instead ([consistency guidance](https://ai.google.dev/gemini-api/docs/speech-generation#consistency-and-what-to-avoid)), so Google does not position `style` as the way to set the language.
- **`system_instruction`: no.** The Interactions API has a top-level `system_instruction`, but the probe returned HTTP 400, `invalid_request`: "Developer instruction is not enabled for this model".
- **Instructions inside the text: no.** The migration guide says inline directions "may be spoken aloud" on 3.8, which is why Cup dropped the 3.1 wrapper.
- **Voice choice.** The Extended Voice Library (`GET /v1beta/voices`) can be filtered by `language_code` and `accent`, and Voice design takes a `language_code` ([voice library](https://ai.google.dev/gemini-api/docs/speech-generation#voice-library), [Voice design](https://ai.google.dev/gemini-api/docs/voice-design)). Google's recommended workflow for a target language is to pick or design a voice that matches it ([recommended workflow](https://ai.google.dev/gemini-api/docs/speech-generation#recommended-workflow)). Cup uses one voice (Charon) for every language, so a per-language voice would be a separate decision; this note did not test it.

## Which languages are supported, and what about mixed text?

Flash-Lite "detects the input language automatically" and supports 101 languages; Flash supports 130 ([model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts#supported-languages), [comparison table](https://ai.google.dev/gemini-api/docs/speech-generation#languages)). The lists name languages, not BCP-47 codes. German, English, French, Italian, Spanish and Dutch are among them; Swedish, Thai and Swahili, for example, are Flash-only.

The docs say nothing about text that mixes languages. They describe detection only as automatic, without saying whether it runs per request or within a request. In the probes, "Der Korrespondent schreibt aus London. „The government will not back down“, sagte der Premierminister am Montag." was transcribed word for word with no `language`, with `de-DE` and with `en-US`, and Whisper identified each clip as German. That suggests the model handles a quotation within a German sentence on its own. The failing case is a segment that is only names: with nothing German around them, the model reads them as English, and `de-DE` did not change that.

## Does Cloudflare AI Gateway pass the fields through?

Yes. The Universal Endpoint's `query` is "the payload as the provider expects it in their official API" ([Universal Endpoint](https://developers.cloudflare.com/ai-gateway/usage/universal/)), and the Google AI Studio provider forwards to Google's REST paths ([provider page](https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/)). Neither page lists fields that are removed or rewritten. The probes confirm it: the 400 errors quote the `language` value and `system_instruction` back from Google, so both reached Google unchanged, and `speech_metadata` changed the audio. Cup already depends on this for `response_format.mime_type` and `sample_rate`.

## Recommendation for Cup

1. **Store the narration language as a BCP-47 tag** (for example `de-AT` from the source page, or plain `de`). That is what the Gemini field requires and what source `lang` attributes already carry, and it is not tied to one provider.
2. **Send it as `generation_config.speech_config[0].language`** for new conversions. It costs nothing, is validated, and does affect the audio (`sv-SE`). Validate the tag before sending, since an invalid tag fails the request with a permanent `invalid_request` error. Keep a fallback (omit the field) for languages Cup does not map, because the API will not reject a well-formed but unsupported code.
3. **Do not rely on the code alone for the byline.** Prototype two additions and decide by listening:
   - a short constant `speech_metadata.style` that names the language (for example "German news narration, German pronunciation"), sent on every segment of the audiobook, which moved the byline toward German in one of two probes; and
   - keeping a names-only segment together with neighbouring narration text, so the model has German context to detect, because mixed sentences were already handled correctly.
4. **Do not use `system_instruction`** (rejected) **or text instructions** (may be spoken aloud).

## Probes

On 2026-11-09, 15 short non-streaming requests went to `gemini-3.8-flash-lite-tts` with voice Charon through Cloudflare AI Gateway's Universal Endpoint (gateway `default`, provider `google-ai-studio`, endpoint `v1beta/interactions`, `Api-Revision: 2026-05-20`, payload logging off, cache skipped). This is the same request shape as production, except that it was sent over REST rather than the Workers binding. Output was 24 kHz `audio/l16`. Cloudflare Whisper large v3 turbo transcribed each clip with automatic language detection, as a rough check of which language the speech sounds like.

| Probe            | Text   | Request difference                                                                | Whisper language (probability) | Transcript of the names      |
| ---------------- | ------ | --------------------------------------------------------------------------------- | ------------------------------ | ---------------------------- |
| `byline-none`    | byline | none                                                                              | en (1.00)                      | Sandra Sheeder               |
| `byline-de-DE`   | byline | `language: "de-DE"`                                                               | en (1.00)                      | Sandra Sheeter               |
| `byline-de-DE-2` | byline | repeat of `de-DE`                                                                 | en (1.00)                      | Elisa Prager, Sandra Sheeter |
| `byline-de-AT`   | byline | `language: "de-AT"`                                                               | en (1.00)                      | Sandra Sheeter               |
| `byline-de`      | byline | `language: "de"`                                                                  | en (1.00)                      | Sandra Sheeter               |
| `byline-sv-SE`   | byline | `language: "sv-SE"`                                                               | sv (0.99)                      | Sandra Skider                |
| `byline-eo`      | byline | `language: "eo"`                                                                  | en (1.00)                      | Sandra Sheeter               |
| `byline-style`   | byline | `style`: "Spoken by a native Austrian German news narrator, German pronunciation" | de (0.92)                      | Sandra Schieder              |
| `byline-style-2` | byline | repeat of `style`                                                                 | en (0.95)                      | Sondra Schieder              |
| `mixed-none`     | mixed  | none                                                                              | de (1.00)                      | verbatim                     |
| `mixed-de-DE`    | mixed  | `language: "de-DE"`                                                               | de (1.00)                      | verbatim                     |
| `mixed-en-US`    | mixed  | `language: "en-US"`                                                               | de (1.00)                      | verbatim                     |

Three more requests failed as described above: `zz-ZZ` and `German` with an invalid-language error, and a `system_instruction` with "Developer instruction is not enabled for this model". Usage was 11 input text tokens and 107 to 132 audio output tokens per byline request: well under one cent in total at the [published rates](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts).

Limits: one or two samples per condition, and generation is not deterministic (every clip differs byte for byte). Whisper's language label and spelling are a proxy for accent, not a listening judgement. Listen to the clips before drawing conclusions about style text.

The [probe archive](./gemini-3.8-tts-language.tar.xz) contains `probe.mjs`, `transcribe.mjs`, one JSON record per request (request body, HTTP status, gateway log ID, usage, error), Whisper transcripts and the MP3s. Unpack and rerun from the repository root:

```sh
tar -xJf docs/research/gemini-3.8-tts-language.tar.xz -C docs/research
node docs/research/gemini-3.8-tts-language/probe.mjs apps/cloudflare-worker/.env.local /tmp/gemini-language-probes byline-none byline-de-DE
node docs/research/gemini-3.8-tts-language/transcribe.mjs apps/cloudflare-worker/.env.local /tmp/gemini-language-probes
```

`probe.mjs` skips probes whose record already exists in the output directory. The transcription step needs MP3s, which the probes write as raw PCM; encode them with `ffmpeg -f s16le -ar 24000 -ac 1 -i <id>.pcm <id>.mp3`. Both scripts make paid calls.
