# What Gemini 3.8 Flash-Lite TTS can condition on without speaking it

> Historical research, incorporated 2026-11-14. It is evidence for [ADR 0027](../adr/0027-flow-narration-across-segment-boundaries-with-overlap-and-cut.md), which built overlap and cut as speech policy 7 in [#336](https://github.com/patricktree/cup/pull/336), deployed on 2026-11-13; [ADR 0028](../adr/0028-withdraw-overlap-and-cut.md) withdrew it in [#352](https://github.com/patricktree/cup/pull/352), merged and deployed on 2026-11-14, because Whisper’s word timing put the cut point in the wrong place, and the effort continues on the map [Map: decouple speech synthesis from synchronization units](https://github.com/patricktree/cup/issues/320). The project did not use the undocumented byte range this page found: in the blind A/B of [Segment boundary approaches](segment-boundary-approaches.md) unspoken context flowed no better than policy 6, and neither did the continuity style. Its finding that the API returns no word timing is why overlap and cut needed speech recognition, and so why it failed. [Original research](https://github.com/patricktree/cup/blob/0bef27b2733379987bd0af64722a2031ab7ada27/docs/research/gemini-tts-unspoken-context.md) on the branch `research/gemini-tts-unspoken-context`.

Researched on 2026-11-12 for [#289](https://github.com/patricktree/cup/issues/289), part of the map [#288: narration flows across segment boundaries](https://github.com/patricktree/cup/issues/288). The question is what `gemini-3.8-flash-lite-tts`, called through the Interactions API over Cloudflare AI Gateway as [`synthesize-gemini-audio.ts`](../../libs/audiobook-production/src/synthesize-gemini-audio.ts) does, offers so that one audio segment's speech continues from its neighbours without speaking them. It builds on [Gemini 3.8 TTS language](gemini-3.8-tts-language.md) (which found `system_instruction` rejected and `speech_metadata.style` unspoken), [Gemini TTS pace controls](gemini-tts-pace-controls.md) and the [Gemini 3.8 comparison](gemini-3.8-tts-comparison.md).

**Short answer:** Google documents no field for unspoken neighbouring text. Every documented route either is rejected for this model or is spoken aloud: `system_instruction` ("Developer instruction is not enabled"), earlier `model_output` turns ("Multiturn chat is not enabled"), `previous_interaction_id` to an earlier segment's interaction ("Audio input modality is not enabled"), and extra `user_input` turns or text blocks, which are read aloud. One **undocumented** behaviour works in probes: a single text block holding neighbouring narration text plus the narration chunk, with a `speech_metadata` annotation whose `start_index`/`end_index` byte range covers only the narration chunk, speaks only that range. That held in 4 of 4 requests, with or without a `style`, with context before the range and on both sides. Whether the unspoken text actually shapes the prosody at the boundary is not established and needs a listening test. The API returns no word or character timing for synthesized speech, so overlap-and-cut needs a separate alignment step. Google says nothing about continuity in `style`; free text there is unspoken and, judging by the usage counters, not even counted as input. Text input is about 1% of a segment's synthesis cost, so tripling it adds about 2.5%.

## Sources

- Google, [Gemini 3.8 Flash-Lite TTS model page and migration guide](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts) (Markdown at `https://aistudio.google.com/docs/models/gemini-3.8-flash-lite-tts.md`), fetched 2026-11-12.
- Google, [Text-to-speech guide](https://ai.google.dev/gemini-api/docs/speech-generation) (Markdown at `https://aistudio.google.com/docs/speech-generation.md`), especially [single-speaker](https://ai.google.dev/gemini-api/docs/speech-generation#single-speaker), [multi-speaker](https://ai.google.dev/gemini-api/docs/speech-generation#multi-speaker), [controlling style](https://ai.google.dev/gemini-api/docs/speech-generation#controllable), the [prompting guide](https://ai.google.dev/gemini-api/docs/speech-generation#prompting-guide), [multi-turn dialogue and voice agents](https://ai.google.dev/gemini-api/docs/speech-generation#multi-turn-and-voice-agents) and [limitations](https://ai.google.dev/gemini-api/docs/speech-generation#limitations).
- Google, [Interactions API reference: create interaction](https://aistudio.google.com/api-reference/interactions-api/create-interaction.md): `input`, `system_instruction`, `previous_interaction_id`, `store`, `generation_config` (including `transcription_config`), `SpeechAnnotation`, `WordInfo`, `AudioResponseFormat` and `Usage`.
- Google, [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts) and the [Gemini 3.5 Transcribe model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe).
- Cup's [ADR 0022](../adr/0022-reserve-70-milliseconds-of-audio-per-narration-text-character.md) for audio per narration text character.
- 13 paid probes run for this note through Cloudflare AI Gateway (see [Probes](#probes)).

## Unspoken context

### What the documentation describes

| Route                                                        | What Google documents                                                                                                                                                                                                                                                                                                                  | Status for TTS                                                                                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dedicated context field (like ElevenLabs' `previous_text`) | None. The speech configuration has only `voice`, `language` and `speaker`; `SpeechAnnotation` has `speaker`, `style`, `start_index` and `end_index` ([reference](https://aistudio.google.com/api-reference/interactions-api/create-interaction.md)).                                                                                   | Does not exist.                                                                                                                                                                                   |
| `system_instruction`                                         | A generic top-level string, "System instruction for the interaction".                                                                                                                                                                                                                                                                  | Rejected for this model: HTTP 400 "Developer instruction is not enabled for this model" ([language probes](gemini-3.8-tts-language.md#can-instructions-be-sent-separately-from-the-spoken-text)). |
| Earlier turns: `user_input` and `model_output` steps         | The reference shows multi-turn input (`user_input`, `model_output`, `user_input`) for text models. The TTS guide uses one `user_input` per request and says to make "one TTS call per turn" for voice agents; it never describes earlier turns as context.                                                                             | A `model_output` step is rejected: HTTP 400 "Multiturn chat is not enabled for this model". Two `user_input` steps are accepted, and **both are spoken** (probe `turns-user-only`).               |
| Several text blocks in one `user_input`                      | Each text block is a turn; the multi-speaker examples speak every block ([multi-speaker](https://ai.google.dev/gemini-api/docs/speech-generation#multi-speaker)).                                                                                                                                                                      | Spoken, by documentation.                                                                                                                                                                         |
| `previous_interaction_id` with `store: true`                 | "The ID of the previous interaction, if any." Nothing TTS-specific.                                                                                                                                                                                                                                                                    | Rejected when the previous interaction is an earlier TTS request: HTTP 400 "Audio input modality is not enabled for this model". It would also have made synthesis serial.                        |
| `speech_metadata.style`                                      | Unspoken "sustained turn-level delivery": emotion, style, prosody, pacing, volume ([controlling style](https://ai.google.dev/gemini-api/docs/speech-generation#controllable)). Nothing about context or continuity.                                                                                                                    | Unspoken, even holding a whole paragraph of neighbouring text (probe `style-previous-text`). Whether the model uses that text as context is unknown; see [style direction](#style-direction).     |
| `speech_metadata` `start_index`/`end_index`                  | The reference's `SpeechAnnotation` carries both fields with text copied from citation annotations: "Start of segment of the response that is attributed to this source. Index indicates the start of the segment, measured in bytes" and "End of the attributed segment, exclusive". The TTS guide and migration guide never use them. | **Undocumented, but in probes it limits speech to the range.** See below.                                                                                                                         |
| Inline text directions                                       | 3.8 treats `text` "strictly as a verbatim transcript"; directions in it "may be spoken aloud" ([migration guide](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts#migration-guide)).                                                                                                                             | Not usable for context.                                                                                                                                                                           |

The model card lists input as "Text" only, and the TTS guide's limitations say TTS models "accept text-only inputs", so conditioning on the neighbouring segment's audio is out, which the `previous_interaction_id` rejection confirms.

### The annotation byte range (undocumented)

In four requests, a single text block held the neighbouring narration text and the narration chunk, separated by a blank line, with one `speech_metadata` annotation whose `start_index` and `end_index` are UTF-8 byte offsets of the narration chunk alone:

```json
{
  "type": "text",
  "text": "<previous narration text>\n\n<this narration chunk>",
  "annotations": [{ "type": "speech_metadata", "start_index": 275, "end_index": 440 }]
}
```

| Probe                       | Text block                                         | Range covers | Audio   | Whisper heard         | Input tokens |
| --------------------------- | -------------------------------------------------- | ------------ | ------- | --------------------- | -----------: |
| `baseline`                  | target only, no annotation                         | –            | 12.00 s | target only           |           45 |
| `annotation-range`          | previous + target, `style: "calm narration"`       | target       | 12.80 s | target only           |          111 |
| `annotation-range-2`        | repeat                                             | target       | 11.40 s | target only           |          111 |
| `annotation-range-no-style` | previous + target, annotation without `style`      | target       | 11.16 s | target only           |          111 |
| `annotation-range-middle`   | before + middle + after, `style: "calm narration"` | middle       | 21.08 s | middle only           |          186 |
| `store-previous`            | middle paragraph alone (for comparison)            | –            | 18.80 s | middle only           |           66 |
| `turns-user-only`           | previous and target as two `user_input` steps      | –            | 30.68 s | previous, then target |          111 |

So the model reads the whole block, bills all of it as text input, and speaks only the annotated range; the annotation needs no `style` to do that. With text on both sides the middle paragraph was 2.3 s (12%) longer than alone. That could be context changing the delivery, or ordinary variation between generations (the target alone ranged from 10.0 to 12.0 s in five requests without a range); one sample cannot tell.

What is not known:

- **Whether the context changes the prosody at all**, and whether it makes the boundary sound continuous. Nothing in the probes measures that; it is the listening question for the prototype.
- **Reliability.** Four samples, all English, all with short context. Untested: German, long narration chunks near the 2,000-character maximum, context that makes the block exceed the 8,192 input-token limit, a heading as context, and whether words at the range edges are ever clipped, doubled or bled into from the context.
- **Stability.** The behaviour is not in the documentation, and the field description reads as copied from citations. Google could change it without notice, and a change could turn unspoken context into spoken context, which would break the acceptance bar's "each segment's audio speaks exactly its own text". A production policy would need a guard, such as the duration check the paid narration evals could do.
- **Interaction with the narration-language style** ([narration language](../architecture/conversion.md#narration-language)). Policy 6 attaches its `style` to the whole block; with a range it would sit on the same annotation. Whether a range weakens the language effect on names-only segments is untested.

## Overlap and cut

The API returns no timing for synthesized speech. A complete response holds `steps[].content[]` with `type`, `mime_type`, `sample_rate`, `channels` and base64 `data`, plus `usage`, `status`, `id` and timestamps of the interaction; nothing aligns audio to text (probe `baseline`). `AudioResponseFormat` has only `mime_type`, `delivery`, `sample_rate` and `bit_rate` ([reference](https://aistudio.google.com/api-reference/interactions-api/create-interaction.md)).

Two plausible routes, both probed:

- `generation_config.transcription_config` with `timestamp_granularities: ["word"]` is documented for speech recognition ("If present, ASR is enabled"), producing `word_info` annotations with `start_offset` and `end_offset`. On the TTS model it was **silently ignored**: HTTP 200, audio only, no annotations (probe `transcription-config`).
- `response_format: [audio, text]` was also silently ignored: audio only (probe `response-format-text`).

An overlap-and-cut approach would therefore need a second step to find the cut point: transcribing the synthesized audio with word timestamps. Google's [Gemini 3.5 Transcribe](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe) offers word-level timestamps at $0.003 per minute of audio input plus $0.002 per minute of text output ([pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-transcribe)); its model page notes that word-level timestamps "Degrades transcription accuracy". Cloudflare's Whisper, which earlier research used, is another option this note did not price. Against synthesis at about $0.009 per minute of audio (below), transcription would add roughly half again to a segment's cost, plus the cost of synthesizing the overlap itself. Whether a cut inside continuous speech sounds clean is a separate listening question; the range annotation above would make it unnecessary if its context works.

## Style direction

Google documents `style` as sustained turn-level delivery: emotion, delivery style, prosody, pacing and volume, with short examples such as "whispered urgently" and "speaking rapidly" ([controlling style](https://ai.google.dev/gemini-api/docs/speech-generation#controllable), [style vs. inline tags](https://ai.google.dev/gemini-api/docs/speech-generation#style-vs-inline-tags)). It says nothing about continuity, context, position in a longer text, or phrases like "continuing mid-article". Its general guidance argues against long or meta style text: "extra prompt text increases drift", start with an empty `style`, and "reuse that exact short string across turns when you want a consistent baseline" ([consistency](https://ai.google.dev/gemini-api/docs/speech-generation#consistency-and-what-to-avoid), [recommended workflow](https://ai.google.dev/gemini-api/docs/speech-generation#recommended-workflow)). For voice agents, which synthesize one turn per call like Cup synthesizes one audio segment per call, it recommends an empty or "one short constant string" `style` and does not offer any continuity mechanism ([multi-turn and voice agents](https://ai.google.dev/gemini-api/docs/speech-generation#multi-turn-and-voice-agents)).

In the probes, both "continuing mid-article, carrying on from the previous paragraph" and a style quoting the whole previous paragraph were unspoken: the transcripts hold only the narration chunk, durations stayed within the baseline's range (11.0 and 11.96 s), and leading silence (0.37 and 0.31 s) was within the 0.15 to 0.67 s of the other probes. Whether either sounds more continuous is a listening question. A style direction is therefore a plausible, cheap lever, not a documented one.

## Cost

Published standard prices for `gemini-3.8-flash-lite-tts` are $0.50 per million text input tokens and $6.00 per million audio output tokens through 2026-12-31, rising to $1.00 and $12.00 from 2027-01-01; audio is 25 tokens per second ([pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts)). Both rates double together, so the ratio holds. Batch halves both.

For a 400-character narration chunk at Cup's measured 70 ms of audio per character ([ADR 0022](../adr/0022-reserve-70-milliseconds-of-audio-per-narration-text-character.md)) and about 4 characters per text token (3.7 to 4.4 in the probes and the comparison):

| Input sent                                  | Text tokens | Input cost | Audio output (28 s, 700 tokens) | Input share | Total vs today |
| ------------------------------------------- | ----------: | ---------: | ------------------------------: | ----------: | -------------: |
| Narration chunk only (today)                |         100 |  $0.000050 |                         $0.0042 |        1.2% |              – |
| Doubled: plus one neighbour of equal length |         200 |  $0.000100 |                         $0.0042 |        2.3% |          +1.2% |
| Tripled: plus both neighbours               |         300 |  $0.000150 |                         $0.0042 |        3.4% |          +2.4% |

The ratio does not depend on chunk length, since both sides scale with characters. In this note's probes, output was exactly 25 audio tokens per second; the [comparison](gemini-3.8-tts-comparison.md#cost) saw counters near 38 per second and some requests reporting 259 audio input tokens (apparently the voice reference). If billing follows those counters, the input share is smaller still. The counters also showed that a `style` annotation adds no input tokens: 45 tokens with a 300-character style, 45 without (probes `style-previous-text`, `baseline`), as the language probes saw before. Whether Google bills the style text is not documented. Either way, input stays a minor share of synthesis cost, as the map requires.

## What this leaves for the prototype

- **Viable, needs listening: neighbouring text in the block, with an annotation range on the narration chunk.** The only route that carries unspoken neighbouring text. Undocumented, so it needs a duration or transcript guard and a fallback, and a listening A/B on the fixture excerpts to show whether it actually changes the boundary.
- **Viable, needs listening: a short constant continuity `style`**, possibly combined with the narration-language style. Documented as unspoken, free by the counters, but not documented to do anything for continuity, and Google warns that extra style text increases drift.
- **Viable only with an external aligner: overlap and cut.** No provider timing; it needs a transcription pass with word timestamps per segment, about half again the synthesis cost, plus the overlap's synthesis.
- **Not viable:** `system_instruction`, `model_output` turns, `previous_interaction_id` chaining, and extra `user_input` turns or text blocks (rejected or spoken).
- **Independent of the provider:** join post-processing (edge-silence trimming and a deliberate pause per boundary kind). Leading silence in these probes ranged from 0.15 to 0.67 s and trailing from 0.28 to 0.64 s, so some of the audible restart may be uneven edge silence rather than prosody.

## Probes

On 2026-11-12, 13 short non-streaming requests went to `gemini-3.8-flash-lite-tts` with voice Charon and `language: "en-US"` through Cloudflare AI Gateway's Universal Endpoint (gateway `default`, provider `google-ai-studio`, endpoint `v1beta/interactions`, `Api-Revision: 2026-05-20`, payload logging off, cache skipped), the production request shape sent over REST. The texts are the Cloudflare fixture excerpt's narration units 0059 to 0061 from the [comparison](gemini-3.8-tts-comparison.md): "previous" is 0060 (271 characters), "target" is 0061 (165 characters). Output was 24 kHz `audio/l16`. Cloudflare Whisper large v3 turbo transcribed every clip to check what was spoken. Edge silence is the time before the first and after the last 10 ms window louder than −40 dBFS.

| Probe                       | Request difference                                                                  | Result                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `baseline`                  | target only                                                                         | 12.00 s, target spoken                                        |
| `turns-model-output`        | `user_input` previous, `model_output` previous, `user_input` target                 | HTTP 400 "Multiturn chat is not enabled for this model"       |
| `turns-user-only`           | `user_input` previous, `user_input` target                                          | 30.68 s, both spoken                                          |
| `style-previous-text`       | target with a style quoting the previous paragraph                                  | 11.96 s, target only, 45 input tokens                         |
| `style-continuing`          | target with style "continuing mid-article, carrying on from the previous paragraph" | 11.00 s, target only                                          |
| `annotation-range`          | previous + target in one block, annotation range on target, short style             | 12.80 s, target only, 111 input tokens                        |
| `annotation-range-2`        | repeat                                                                              | 11.40 s, target only                                          |
| `annotation-range-no-style` | same range, no style                                                                | 11.16 s, target only                                          |
| `annotation-range-middle`   | 0059 + 0060 + 0061 in one block, range on 0060                                      | 21.08 s, 0060 only, 186 input tokens                          |
| `store-previous`            | previous alone with `store: true`                                                   | 18.80 s, previous spoken                                      |
| `previous-interaction`      | target with `previous_interaction_id` of `store-previous`                           | HTTP 400 "Audio input modality is not enabled for this model" |
| `transcription-config`      | target with `transcription_config` and word timestamps                              | 11.40 s, audio only, no timing                                |
| `response-format-text`      | target with `response_format: [audio, text]`                                        | 10.00 s, audio only, no text                                  |

Limits: one to four samples per condition, English only, and generation is not deterministic. Whisper shows which words were spoken, not how they sound. No listening judgement has been made.

The [probe archive](./gemini-tts-unspoken-context.tar.xz) contains `probe.mjs`, `transcribe.mjs`, one JSON record per request (request body, HTTP status, gateway log ID, interaction ID, usage, and the response with audio data redacted), Whisper transcripts and the MP3s. Unpack and rerun from the repository root:

```sh
tar -xJf docs/research/gemini-tts-unspoken-context.tar.xz -C docs/research
node docs/research/gemini-tts-unspoken-context/probe.mjs apps/cloudflare-worker/.env.local /tmp/unspoken-context-probes baseline annotation-range
```

`probe.mjs` skips probes whose record already exists and writes raw PCM; encode it with `ffmpeg -f s16le -ar 24000 -ac 1 -i <id>.pcm <id>.mp3` before running `transcribe.mjs <env-file> <out-dir>`. Both scripts make paid calls.
