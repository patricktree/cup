# Which aligner finds overlap-and-cut points reliably

> Historical research, incorporated 2026-11-14. Its recommendation of Whisper large v3 turbo is the aligner decision in [ADR 0027](../adr/0027-flow-narration-across-segment-boundaries-with-overlap-and-cut.md), built as speech policy 7 in [#336](https://github.com/patricktree/cup/pull/336) and deployed on 2026-11-13. The build differed: it spoke only the previous chunk’s last sentence, so it had one cut per segment, and a failed cut check fell back to synthesizing the narration chunk alone instead of retrying the overlap take ([#318](https://github.com/patricktree/cup/issues/318)). [ADR 0028](../adr/0028-withdraw-overlap-and-cut.md) withdrew it in [#352](https://github.com/patricktree/cup/pull/352), merged and deployed on 2026-11-14, because Whisper’s word timing put the cut point in the wrong place: Whisper starts the chunk’s first word early, over the pause before it, the defect this page saw at the French infobox and put down to the cut rule’s search window. The effort continues on the map [Map: decouple speech synthesis from synchronization units](https://github.com/patricktree/cup/issues/320). [Original research](https://github.com/patricktree/cup/blob/b3672e77bfc92bce2451a13423eb3199543ffd27/docs/research/overlap-cut-aligner.md) on the branch `research/overlap-cut-aligner`.

Researched on 2026-11-13 for [Which aligner finds overlap-and-cut points reliably?](https://github.com/patricktree/cup/issues/316), part of the map [Map: narration flows across segment boundaries](https://github.com/patricktree/cup/issues/288). It builds on [Which approach makes segment boundaries inaudible?](https://github.com/patricktree/cup/issues/291), whose blind listening test chose overlap and cut: each audio segment is synthesized from the previous narration chunk's last sentence, its own narration chunk and the next narration chunk's first sentence in one request, and is cut in the middle of the longest silence (≤ −45 dBFS) at each chunk edge, before the Sonic ×1.05 stretch. Gemini TTS returns no word timing, so something has to find those edges. The [prototype](https://github.com/patricktree/cup/blob/50de4acb0023b6baec3e6d3448bd7cd9d12ee7ad/libs/audiobook-production/prototype-segment-boundary-approaches/render.mjs) used Whisper large v3 turbo on Workers AI and placed all of its 26 cuts correctly once it aligned word by word.

**Short answer:** use **Whisper large v3 turbo on Workers AI** with the prototype's word alignment. On 58 new segments (116 cuts) in English, German and French, chosen for numbers, abbreviations, names, headings, tables and mid-paragraph splits, both Whisper and Gemini 3.5 Transcribe put **116 of 116 cuts in the right pause**, and every cut segment spoke exactly its own narration chunk at both edges. Cutting on silence alone did not: 44 of 58 segments (±1.5 s search window) or 49 of 58 (±3 s) were right, failing at headings, table cells, list items and short chunks. Whisper costs $0.0005 per minute of audio, about 6% of synthesis, against $0.0054 (60%) for Gemini 3.5 Transcribe, with similar latency, and covers more of Cup's narration languages (68 of 99 against 65). A second transcription of each cut segment found no aligner error that the aligner's own transcript did not already show, so the spoken-text check should run on the alignment pass itself: each cut must sit in a pause of at least 150 ms with an aligned word at most two words away on each side, or the segment is synthesized again.

## Sources

- Google, [Gemini 3.5 Transcribe model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe) (Markdown at `https://aistudio.google.com/docs/models/gemini-3.5-transcribe.md`): inputs, audio limits, feature compatibility and supported languages. Fetched 2026-11-13.
- Google, [Audio transcription guide](https://ai.google.dev/gemini-api/docs/transcribe) (Markdown at `https://aistudio.google.com/docs/transcribe.md`), especially [word-level timestamps](https://ai.google.dev/gemini-api/docs/transcribe#word-timestamps), [transcription modes](https://ai.google.dev/gemini-api/docs/transcribe#transcription-modes), [parsing output](https://ai.google.dev/gemini-api/docs/transcribe#parsing-output), [supported formats](https://ai.google.dev/gemini-api/docs/transcribe#supported-formats), [parameter reference](https://ai.google.dev/gemini-api/docs/transcribe#parameter-reference) and [limitations](https://ai.google.dev/gemini-api/docs/transcribe#limitations). Fetched 2026-11-13.
- Google, [File input methods](https://ai.google.dev/gemini-api/docs/file-input-methods) (inline data up to 100 MB per request) and the [Interactions API reference](https://aistudio.google.com/api-reference/interactions-api/create-interaction.md) (`AudioContent` with `data` and `mime_type`). Fetched 2026-11-13.
- Google, [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-transcribe) for Gemini 3.5 Transcribe and [Gemini 3.8 Flash-Lite TTS](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-lite-tts). Fetched 2026-11-13.
- Cloudflare, [`@cf/openai/whisper-large-v3-turbo` model page](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) and its [input schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-input.json): parameters, $0.000513 per audio minute. Fetched 2026-11-13.
- Cloudflare, [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) (automatic speech recognition: 720 requests per minute, last updated 2026-09-17) and [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) (10,000 free Neurons a day, then $0.011 per 1,000). Fetched 2026-11-13.
- OpenAI, [`whisper/tokenizer.py` `LANGUAGES`](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/tokenizer.py), the 100 languages Whisper's tokenizer knows.
- Cup at [`50f3ba60`](https://github.com/patricktree/cup/tree/50f3ba6019dd1ecbb23e872a3eef025aad9c9b07): [`narration-language-speakability.ts`](https://github.com/patricktree/cup/blob/50f3ba6019dd1ecbb23e872a3eef025aad9c9b07/libs/audiobook-production/src/narration-language-speakability.ts) (the 99 language subtags Cup narrates with Gemini 3.8 Flash-Lite TTS), [`narration-chunking.ts`](https://github.com/patricktree/cup/blob/50f3ba6019dd1ecbb23e872a3eef025aad9c9b07/libs/narration-document-creation/src/narration-chunking.ts) (`MAX_CHUNK_CHARACTERS = 2_000`) and [`synthesize-gemini-audio.ts`](https://github.com/patricktree/cup/blob/50f3ba6019dd1ecbb23e872a3eef025aad9c9b07/libs/audiobook-production/src/synthesize-gemini-audio.ts) (the request shape and its 90-second timeout).
- Prior research: [Gemini TTS unspoken context](gemini-tts-unspoken-context.md) (no word timing from TTS; Gemini 3.5 Transcribe's prices).
- Paid probes run for this note on 2026-11-13 (see [Probes](#probes)).

## Sample

The eval fixtures of `libs/narration-source-analysis` (`test/evals/cases/*/expected.json`) supplied the text. A script scored every narration unit by what an aligner must place at its two edges: the last six words of the previous unit's last sentence plus the unit's first six, and the unit's last six plus the first six of the next unit's first sentence. It picked the highest-scoring units, no two adjacent, per article, then added four oversized narration blocks split at the middle sentence (a mid-paragraph boundary, joined by a space) and one 1,971-character chunk made of two adjacent paragraphs, close to the 2,000-character limit.

| Fixture                                       | Language |  Segments | Notes                                                           |
| --------------------------------------------- | -------- | --------: | --------------------------------------------------------------- |
| Anthropic, "Demystifying evals for AI agents" | en       |    11 + 2 | Step headings ("Step 2: …"), "100%", abbreviations              |
| Cloudflare, Kitesurf                          | en       |         8 | Table cells ("380 ms", "4.7× less than Chromium"), bylines      |
| Wikipedia (en), "Ich bin ein Berliner"        | en       | 7 + 2 + 1 | Citation markers, German quotes, "i.e.", "U.S.", the long chunk |
| derStandard, farm subsidies                   | de       |     8 + 2 | Byline, "88.000", "1,3 Milliarden", headings                    |
| Wikipedia (de), "Ich bin ein Berliner"        | de       |     9 + 2 | English quotes inside German text, list items, "UNESCO"         |
| Wikipedia (fr), Sherlock Holmes               | fr       |         6 | Infobox fragments ("1854", "Origine"), years, titles            |

That is 58 segments and 116 cuts: 31 English, 21 German and 6 French segments; 49 segments at paragraph boundaries, 8 on either side of 4 mid-paragraph splits, and the long chunk. By edge content, 43 segments have a number at an edge, 12 an abbreviation, 57 a capitalized name and 49 a heading next to or inside them. The French segments probe a third narration language.

## Method

1. **Synthesis, once per segment.** The overlap block went to `gemini-3.8-flash-lite-tts`, voice Charon, through Cloudflare AI Gateway with policy 6's request shape: the language code (`en`, `de`, `fr`) and the style "Read in German with standard German pronunciation." (per language), `audio/l16` at 24 kHz. The provider audio was encoded to a 128 kbps MP3 once, and every aligner read that same file.
2. **Aligners.**
   - **Whisper:** `@cf/openai/whisper-large-v3-turbo` over the Workers AI REST API, with `language` set; word timings from `segments[].words`.
   - **Gemini 3.5 Transcribe:** `gemini-3.5-transcribe` through the AI Gateway Universal Endpoint (provider `google-ai-studio`, endpoint `v1beta/interactions`), inline base64 MP3 (`{type: "audio", data, mime_type: "audio/mp3"}`), `transcription_config.language_codes` `en-US`, `de-DE` or `fr-FR`, and `mode: {type: "verbatim", timestamp_granularities: ["word"]}`. Word timings arrive as `word_info` annotations with `start_offset` and `end_offset` strings such as `"0.400s"`.
   - Both feed the prototype's `cutAt` unchanged: a longest-common-subsequence alignment of normalized transcript words with the block's words, the largest inter-word gap between the last aligned word before the boundary and the first aligned word after it, and the middle of the longest silent run within 0.25 s of that gap.
   - **Silence alone, no aligner:** the boundary's time estimated from its share of the block's characters, measured between the first and last voiced 10 ms frame, and the cut in the middle of the longest silent run within ±1.5 s or ±3 s of that estimate.
3. **Verification.** Each distinct cut segment (unstretched; the stretch does not change words) was transcribed again by both Whisper and Gemini 3.5 Transcribe without timestamps. A script aligned each transcript with the narration chunk alone and inspected the words before the first and after the last aligned chunk word: overlap-sentence words there are a **repeat**, missing chunk words with nothing in their place a **skip**, and other words in their place a **substitution** (a number or a unit written differently). An edge was correct when both verifiers heard it clean, or one heard it clean and the other only spelled it differently; every other edge was reviewed by hand against both transcripts, the provider transcript and the frame levels. Cut positions were also compared across methods: two cuts within 0.3 s of each other sit in the same pause.

## Cut accuracy

| Method                 | Segments speaking exactly their chunk | Cuts in the right pause | English | German | French |
| ---------------------- | ------------------------------------: | ----------------------: | ------: | -----: | -----: |
| Whisper large v3 turbo |                               58 / 58 |               116 / 116 |   62/62 |  42/42 |  12/12 |
| Gemini 3.5 Transcribe  |                               58 / 58 |               116 / 116 |   62/62 |  42/42 |  12/12 |
| Silence alone, ±1.5 s  |                               44 / 58 |               100 / 116 |   53/62 |  39/42 |   8/12 |
| Silence alone, ±3 s    |                               49 / 58 |               107 / 116 |   59/62 |  38/42 |  10/12 |

Whisper and Gemini chose the same pause for 114 of the 116 cuts; the other two differ in where inside the right pause they cut (below). Together with the prototype's 26, Whisper alignment has now placed 142 of 142 cuts correctly.

**Silence alone** fails where the pause it is looking for is not the longest one near the character estimate. The failures were headings ("Step 2: Write unambiguous tasks…" lost "Step 2"; "Step 0. Start early" and "Step 6: Check the transcripts" were cut off; "Kein Luxusleben" and "Genesis and execution of the speech" were spoken by the segment before), table cells and infobox fragments (both cuts of "1,173 ms", "Origine" and "Une étude en rouge, 1887: roman" fell into the same pause, leaving nothing), a list item, a mid-paragraph split ("Zwar war Kennedy keineswegs gewillt" went to the previous segment), and the end of a 123-word paragraph, where the estimate drifted by more than 1.5 s. A wider window fixes drift but makes both cuts of a short chunk pick the same pause more often (12 empty edges at ±3 s against 4 at ±1.5 s). No window works for both, which is why the [prototype's](https://github.com/patricktree/cup/blob/50de4acb0023b6baec3e6d3448bd7cd9d12ee7ad/libs/audiobook-production/prototype-segment-boundary-approaches/README.md) first character-count aligner also failed on numbers.

**Defects inside the right pause**, which the word checks cannot see:

- **Gemini, derStandard byline:** Gemini 3.5 Transcribe left the byline "András Szigetvari" out of its transcript and placed "Was" 0.5 s later than Whisper did (2.9 s against 2.36 s; its offsets come in 0.1 s steps). With no aligned word before the boundary, `cutAt` searched only around the first two chunk words and cut at 2.855 s, in a 10 ms dip at the onset of "Was" rather than in the 890 ms pause before it. Both verifiers still heard "Was", but the segment starts on a clipped consonant.
- **Whisper, French infobox:** Whisper stretched "Naissance" back over the 1.7 s pause before it (25.16 to 27.56 s), so the word gap was 0 and the 0.25 s search window found only the first 210 ms of the pause. The cut at 25.3 s is correct by words but keeps almost none of the pause; Gemini cut in its middle at 25.76 s.

Both come from the prototype's cut rule rather than the aligner's choice of pause: a production cut rule should search the whole span between the two aligned words (from the start of the word before to the end of the word after, or the block's edge when no word is aligned on that side) and take the longest silence there, not only a window around the transcript's word gap.

## What the second transcription showed

- **It found no aligner error.** Every cut that both aligners agreed on was verified correct. The aligner's own transcript of the provider audio already says which words lie on each side of a cut; a second transcription repeats that question on less audio.
- **Exact-word checks raise false alarms.** On the 116 correct Whisper cuts, the Whisper verifier's words differed from the text at 9 edges (8%) and Gemini's at 3 (3%): "Twenty-two" heard as "22", "ms" spoken as "milliseconds", "doughnut" as "donut", "Civis" as "Sivis", "Bil'iner" as "Beliner", "Kitesurf" as "Kite Surf", "Origine" as "Origines". A check must tolerate substitutions and flag only spoken overlap words or missing chunk words with nothing in their place.
- **Gemini 3.5 Transcribe drops other-language passages.** With `de-DE` as its language code, it left the English Kennedy quotes in the German Wikipedia article out of both the provider transcript and the verification transcript, and it dropped the derStandard byline. Whisper with `language: "de"` also left the first English quote out of the provider transcript, but transcribed it from the shorter cut segment. Both aligners still cut correctly there because the German words around the boundary anchored the alignment. A chunk-coverage threshold on either transcript would therefore misfire: aligned chunk words covered as little as 49% (Whisper) and 50% (Gemini) of correct segments, for the mixed-language quotes and the "1,173 ms" table cell.
- **Short or silent audio.** Gemini 3.5 Transcribe answered `status: "completed"` with no text, four times in a row, for a 0.25 s near-silent clip. Whisper invented "C'est parti." for a 0.25 s silent clip, the well-known Whisper hallucination on silence. Neither matters for a cut chosen by an aligner, but a check must not trust a transcript of a near-empty segment.

Two measurements of the aligner pass support a check that needs no second transcription. Every correct Whisper cut sits in a silent run of at least 170 ms (5th percentile 360 ms, median 730 ms); the one Gemini defect sat in 10 ms. And the nearest aligned block word was at most two words from the boundary on both sides for 115 of 116 Whisper cuts; the exception was the mixed-language German quote, 25 words, where the cut was still right.

## Cost

Per minute of provider audio, at the published standard prices on 2026-11-13:

| Step                                       | Price basis                                                                                                                           | Per minute | Against synthesis (to 2026-12-31 / from 2027-01-01) |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------: | --------------------------------------------------: |
| Synthesis, Gemini 3.8 Flash-Lite TTS       | $6.00 per million audio output tokens, 25 tokens per second; doubles to $12.00 on 2027-01-01                                          |    $0.0090 |                                                100% |
| Whisper large v3 turbo, Workers AI         | $0.000513 per audio minute (after 10,000 free Neurons a day)                                                                          |    $0.0005 |                                         5.7% / 2.9% |
| Gemini 3.5 Transcribe with word timestamps | $2.00 per million audio input tokens ($0.003 per minute) plus $12.00 per million output tokens; measured 196 output tokens per minute |    $0.0054 |                                           60% / 30% |

Google estimates $0.002 per minute of output for 175 text tokens per minute; word timestamps measured slightly more here (7,119 output tokens for 36.2 minutes). The probes synthesized 2,175 s of provider audio to keep 1,298 s, 1.68 times the audio, so per minute of narration track both synthesis and the aligner cost 1.68 times the figures above: overlap and cut with Whisper costs about 1.78 times policy 6, with Gemini 3.5 Transcribe about 2.7 times until the TTS price rise.

## Latency

Measured from a laptop in Europe over REST, one request per segment, five in parallel:

| Call                  | Median | 90th percentile | Slowest              | Median per audio minute |
| --------------------- | -----: | --------------: | -------------------- | ----------------------: |
| Synthesis             |  7.6 s |          10.6 s | 15.3 s (129 s audio) |                       — |
| Whisper               |  4.5 s |          12.5 s | 34.6 s (66 s audio)  |                   9.0 s |
| Gemini 3.5 Transcribe |  5.0 s |           8.1 s | 12.5 s (129 s audio) |                   8.7 s |

The aligner runs after synthesis, so it adds roughly 60% to a segment's synthesis step at the median. Whisper's tail was longer (one 66 s segment took 34.6 s, another 18.7 s), Gemini's steadier. Inside a Worker, Whisper would run through the `AI` binding (`env.AI.run`), without a network hop out of Cloudflare.

## Limits

- **The longest segment.** The 1,971-character chunk with its overlap (2,285 characters) synthesized to 129 s of audio, a 2.1 MB MP3; synthesis took 15.3 s, Whisper 16.2 s and Gemini 12.5 s, and both aligners cut it correctly. Its base64 body is about 2.8 MB.
- **Whisper on Workers AI** documents no audio-length or body-size limit on its model page; its input is a base64 string or a binary body. In probes it transcribed 3 minutes (3.8 MB base64, 14.5 s), 10 minutes (12.8 MB, 51.6 s) and 20 minutes (25.6 MB, 109 s) in one request, with word timings to the end. The documented limit is 720 requests per minute for speech recognition.
- **Gemini 3.5 Transcribe** documents audio up to an hour per request, but 30 minutes with word timestamps; longer audio "is truncated at the limit while still returning `status: "completed"`". Inline data is limited to 100 MB per request. Word timestamps are incompatible with custom vocabulary and with Smart transcription and "may degrade overall transcription accuracy". In probes, 3 minutes took 11.0 s and 10 minutes 28.6 s, with word timings to 599.6 s. Batch, Flex and Priority inference are not supported.

Both limits are far above Cup's longest segment.

## Narration languages

Cup narrates in the 99 language subtags Gemini 3.8 Flash-Lite TTS speaks (`narration-language-speakability.ts`). Comparing subtags, with Whisper's older codes mapped (`tl` for Filipino, `no` for Norwegian Bokmål, `jw` for Javanese) and Transcribe's `cmn` counted as Chinese:

| Aligner                | Languages it lists               | Cup languages covered | Covered only by it     |
| ---------------------- | -------------------------------- | --------------------: | ---------------------- |
| Whisper large v3 turbo | 100 (`tokenizer.py`)             |                    68 | eu, ht, lo, nn, si, ta |
| Gemini 3.5 Transcribe  | 85+ locales, 77 language subtags |                    65 | ceb, ky, or            |
| Either                 |                                  |                    71 |                        |

28 Cup languages are covered by neither, mostly regional languages of India, Indonesia and Africa: Acehnese, Akan, Awadhi, Balinese, Banjar, Bhojpuri, Buginese, Central Kurdish, Chhattisgarhi, Egyptian Arabic (`arz`; Transcribe lists `ar-EG` as Arabic), Ganda, Iloko, Kamba, Kashmiri, Kikuyu, Kinyarwanda, Kongo, Magahi, Maithili, Manipuri, Minangkabau, Mizo, Nigerian Fulfulde, Northern Sotho, Nyanja, Santali, South Azerbaijani and Southern Pashto (Whisper has Azerbaijani `az` and Pashto `ps`, which may serve the last two). Listing a language is not accuracy in it: only English, German and French were measured here. Cloudflare's model page names no languages for Whisper; Workers AI passes `language` through. Gemini 3.5 Transcribe wants regional BCP-47 codes from its list (`de-DE`, not `de-AT`), although it also accepted a bare `en`.

For a language no aligner covers, or when the check below fails twice, a segment can fall back to policy 6's request (its own narration chunk alone): silence alone is no fallback, as it got 9 to 14 of these 58 segments wrong.

## Recommendation

- **Aligner:** Whisper large v3 turbo on Workers AI, called through the Worker's `AI` binding, with the narration language's subtag as `language`, aligned word by word as in the prototype. It matched Gemini 3.5 Transcribe on accuracy (116 of 116), costs a tenth as much (6% of synthesis against 60%), needs no Google request of its own and covers three more of Cup's languages. Gemini 3.5 Transcribe is a workable second aligner, for example for Cebuano, Kyrgyz and Odia, but drops other-language passages and leading names when given a language code.
- **Cut rule:** keep the longest common subsequence over normalized words and the middle of the longest silence ≤ −45 dBFS, but search the whole span between the aligned words on either side of the boundary (or the block's edge when one side has none), not a 0.25 s window around Whisper's word gap, because Whisper stretches word ends over pauses.
- **Spoken-text check:** derive it from the alignment pass, with no second transcription. Accept a segment when, at each cut, the nearest aligned block words on both sides are at most two words from the chunk edge and the cut lies in a silent run of at least 150 ms; otherwise retry the segment's synthesis, and after a second failure fall back to synthesizing the narration chunk alone. On this sample that check passes 115 of 116 correct Whisper cuts (the 25-word English quote in a German chunk fails it) and would have caught the one clipped Gemini cut. Do not gate on chunk coverage or on exact edge words: transcription differences in numbers, units and names make both misfire.

## Limits of this study

- One synthesis per segment; Gemini TTS is not deterministic, so a different take could pause differently. No take in this sample visibly skipped or repeated text of its own block.
- Correctness is judged by two transcribers and frame levels, not by ear. A cut can be correct by words and still sound clipped, as the Gemini byline case shows; the prototype's listening page remains the judgement on sound.
- French is one article with many infobox fragments; no other language beyond English and German was measured, and Whisper's word timing is known to vary by language.
- Latency was measured from outside Cloudflare over REST; inside a Worker the AI binding avoids the public network but not the model's own time.

## Probes

All 2026-11-13, through Cloudflare AI Gateway (`default` gateway, payload logging off, cache skipped) and the Workers AI REST API:

- `smoke.mjs`: one short English block with numbers and abbreviations through synthesis, Whisper and four Gemini 3.5 Transcribe request shapes (MP3 or WAV, `en-US`, `en` or no language code); all accepted, with identical word timing.
- `render.mjs`: 58 syntheses, 116 aligner passes and verification by both transcribers of 120 distinct cut segments (2,567 s; 7 more cut segments were empty).
- `limits.mjs`: Whisper on 3, 10 and 20 minutes and Gemini 3.5 Transcribe on 3 and 10 minutes of concatenated provider audio, with no new synthesis.

Paid spend at list prices: synthesis $0.33 (54,700 audio and 7,800 text tokens), Gemini 3.5 Transcribe $0.50 (aligner $0.19, verification $0.23, limits $0.07), Whisper $0.06 (113 minutes, partly inside the free Neuron allocation): about **$0.89** in total.

The [probe archive](./overlap-cut-aligner.tar.xz) holds the scripts, `segments.json`, one JSON record per segment (request text, usage, both aligners' transcripts and word timings, every method's cuts and silence lengths, and the verification transcripts), `summary.json`, `limits.json` and the provider MP3 of every segment. Unpack and rerun from the repository root:

```sh
tar -xJf docs/research/overlap-cut-aligner.tar.xz -C docs/research
node docs/research/overlap-cut-aligner/select.mjs /tmp/segments.json
node docs/research/overlap-cut-aligner/render.mjs apps/cloudflare-worker/.env.local /tmp/segments.json /tmp/overlap-cut-aligner 5
node docs/research/overlap-cut-aligner/analyze.mjs /tmp/overlap-cut-aligner > /tmp/summary.json
```

`render.mjs` and `limits.mjs` make paid calls and skip segments whose record already exists; `analyze.mjs` makes none and reruns on the archived records in `overlap-cut-aligner/runs/main/`. The archived records keep the cut times but not the raw PCM, so a rerun of `render.mjs` on them synthesizes again.
