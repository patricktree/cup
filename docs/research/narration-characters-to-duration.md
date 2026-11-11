# Narration audio per character at today's pace

> Historical research, incorporated 2026-11-11 by [ADR 0022](../adr/0022-reserve-70-milliseconds-of-audio-per-narration-text-character.md), whose 70 ms rate rests on the measurements below together with the ×1.05 renders of the listening prototype ([#266](https://github.com/patricktree/cup/issues/266)), about 62 ms per character of running text. Cup now differs from the state described below: `estimateAudioDuration` reserves `max(1000, characters × 70)` ms instead of 80, and new conversions use speech policy 6, which sends the policy-5 request and time-stretches its audio by ×1.05.

[Original investigation](https://github.com/patricktree/cup/blob/5e7185f76bad1e98bd1f526cb93d4fac3adb0ad6/docs/research/narration-characters-to-duration.md).

Researched on 2026-11-11 for [#265](https://github.com/patricktree/cup/issues/265), part of the map [#263: narrate a little faster](https://github.com/patricktree/cup/issues/263). The question is how many milliseconds of narration audio one character of narration text produces with Gemini 3.8 Flash-Lite TTS, voice Charon, speech-config policy 5, and how that compares to the flat 80 ms per character that `estimateAudioDuration` reserves. No new synthesis was run; every number comes from audio that earlier experiments or local development conversions already produced.

**Short answer:** for a whole article at policy 5, about **70 ms per character in both English and German**, roughly 87–90% of the 80 ms reservation. Running text alone is about 68–70 ms per character; headings and bylines raise the average. The policy-5 sample is small (24 English and German clips of 12 texts), so read it as 70 ± 5 ms. Policy 4, which sent no language code and no style, was measurably faster on the same texts: 61 ms per character for running text and 60–66 ms per character for whole articles. On paired texts, the policy-5 request took 9% (German) to 13% (English) longer than the policy-4 request. No measured article exceeded its reservation; single segments did: names-only bylines (100–109 ms per character in German) and very short headings, because each segment carries roughly one second of audio regardless of its length.

## Definitions

- **Characters** are what the reservation counts: `narrationText.length` of each synchronization unit, in UTF-16 code units, summed in `run-prepare-audiobook-workflow.ts` (`libs/create-audiobook-from-url-workflow/src/run-prepare-audiobook-workflow.ts`). Each segment is reserved `max(1000, characters × 80)` ms (`libs/conversion-contracts/src/duration-accounting.ts`).
- **Policy 5** sends `generation_config.speech_config[0].language` with the narration language tag and a `speech_metadata.style` annotation `"Read in <English name> with standard <English name> pronunciation."` on every segment (`libs/audiobook-production/src/synthesize-gemini-audio.ts`, `selectSpokenLanguage`). **Policy 4** sends neither (`libs/audiobook-production/src/speech-synthesis-config.ts`).
- A clip counts as a **policy-5 shape** or **policy-4 shape** when its archived request body matches that policy's request for the same model and voice, even when it was sent by a research harness rather than by Cup.
- **Settled duration** in production is counted in 24 ms MP3 frames (`libs/audiobook-production/src/audio-format.ts`). The archived runs measured PCM length or MP3 duration with `ffprobe`; the frame rounding and encoder padding change a segment by at most a few tens of milliseconds.

## Sources

| Source                                                                                                                                                                                                      | Model and request                                                                                                  | Clips with duration                                                                           | Duration from                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------- |
| [Gemini 3.8 comparison](gemini-3.8-tts-comparison.md), 2026-09-30, `gemini-results.json` and `baseline-results.json` in its [archive](gemini-3.8-tts-comparison.tar.xz)                                     | Flash-Lite and Flash, Charon, policy-4 shape; archived Gemini 3.1 and Eleven v3 baselines                          | 12 per model: 8 English (Anthropic, Cloudflare), 4 German (derStandard), 63 to 659 characters | PCM length (`audioSeconds`)      |
| [Narration language by ear](narration-language-by-ear.md), 2026-11-09, `synthesize.mjs` and `out/*.mp3` in its [archive](narration-language-by-ear.tar.xz)                                                  | Flash-Lite, Charon, five request variants including the policy-5 shape (`code+style`) and policy-4 shape (`none`)  | 110: 11 texts × 5 variants × 2 takes; 22 policy-5 and 22 policy-4 clips                       | `ffprobe` of the 64 kbps MP3s    |
| [Gemini 3.8 TTS language](gemini-3.8-tts-language.md) and [Gemini TTS language](gemini-tts-language.md) probe records, 2026-11-09, in their archives                                                        | Flash-Lite, Charon, mostly names-only byline probes; two policy-5-shape clips                                      | 26, of which 5 policy-4 shape and 2 policy-5 shape                                            | PCM length (`audioSeconds`)      |
| Local development conversions in the main checkout's Miniflare state (`apps/web-app/.wrangler/state/v3`): settled segment rows of the duration ledger joined with each conversion's stored `audiobook.json` | Flash-Lite, Charon, policy 4 per the manifest's `speechConfig`; real Gemini synthesis, not the fake speech adapter | 31 settled segments of 6 conversions (4 derStandard, one article twice; 2 Pi 1.0 runs)        | Ledger `actual_ms`, 24 ms frames |

The narration-source-analysis eval fixtures (`libs/narration-source-analysis/test/evals/cases`) hold source HTML and expected selections but no audio, so they add no durations. Production segment durations were not queried: that would need production access, which this ticket did not use. The local development state holds no policy-5 conversion.

Every segment was checked against the ledger: its `narration_characters` equals the manifest unit's `narrationText.length`. The fake speech adapter returns a fixed 100 ms tone (`libs/audiobook-production/src/speech-synthesis-ai.fake.ts`), and none of the local durations match that, so they are real synthesis.

## Policy 5 (today)

Policy-5-shape clips, Flash-Lite, Charon. "Pooled" divides total audio by total characters, which is what an article's reservation compares against; the spread is across clips.

| Language | Segment kind               | Clips | Characters | Pooled ms/char | Median | Range     | vs 80 ms |
| -------- | -------------------------- | ----: | ---------: | -------------: | -----: | --------- | -------: |
| English  | Running text               |     4 |        754 |           69.9 |   70.3 | 64.4–75.1 |      87% |
| English  | Heading joined with byline |     2 |        234 |           75.2 |   75.2 | 74.5–75.9 |      94% |
| English  | Heading alone (74 chars)   |     2 |        148 |           71.6 |   71.6 | 71.4–71.9 |      90% |
| English  | Byline (41 chars)          |     2 |         82 |           86.8 |   86.8 | 85.9–87.8 |     109% |
| English  | **All**                    |    10 |      1,218 |       **72.2** |   73.2 | 64.4–87.8 |  **90%** |
| German   | Running text               |     9 |      1,730 |           68.6 |   68.4 | 64.2–73.5 |      86% |
| German   | Heading alone (71 chars)   |     2 |        142 |           91.3 |   91.3 | 87.3–95.2 |     114% |
| German   | Names-only byline (43)     |     3 |        129 |          107.9 |  108.8 | 106–109   |     135% |
| German   | **All**                    |    14 |      2,001 |       **72.7** |   71.8 | 64.2–109  |  **91%** |

The English "All" row is the prototype's 10 clips; the German row adds the two policy-5-shape probes from [Gemini TTS language](gemini-tts-language.md) (a 134-character mixed sentence at 71.3 ms/char and the byline at 106 ms/char). The texts are the prototype's: one German derStandard article cut into title, lead, byline, body and an English quotation, and one English article written for the prototype. Neither is a full article, so the "All" rows weight headings and bylines more heavily than a real article would.

## Policy 4 and the pace difference

Policy 4 had far more audio: three research runs plus the local conversions.

| Language | Segment kind                 | Clips | Characters | Pooled ms/char | Median | Range     | vs 80 ms |
| -------- | ---------------------------- | ----: | ---------: | -------------: | -----: | --------- | -------: |
| English  | Running text                 |    18 |      6,285 |           61.1 |   61.6 | 56.9–68.0 |      76% |
| English  | Heading followed by body     |     4 |        558 |           72.8 |   71.3 | 64.6–91.4 |      91% |
| English  | Heading or short line alone  |    14 |        550 |           87.0 |   89.7 | 65.3–344  |     109% |
| German   | Running text                 |    17 |      4,616 |           61.3 |   61.4 | 57.2–67.5 |      77% |
| German   | Heading followed by body     |     5 |        760 |           64.9 |   71.8 | 58.8–74.8 |      81% |
| German   | Heading alone                |     6 |        401 |           81.6 |   81.3 | 70.8–98.0 |     102% |
| German   | Names-only byline (43 chars) |     4 |        172 |          100.9 |   99.5 | 98.6–106  |     126% |

Whole articles and excerpts at policy 4, the ratio a conversion's total reservation sees:

| Article                                      | Language | Segments | Characters | Audio          |    ms/char | Audio / reservation |
| -------------------------------------------- | -------- | -------: | ---------: | -------------- | ---------: | ------------------: |
| Anthropic evals excerpt (3.8 comparison)     | English  |        4 |      1,141 | 69.5 s         |       60.9 |                 76% |
| Cloudflare Kitesurf excerpt (3.8 comparison) | English  |        4 |      1,091 | 71.8 s         |       65.8 |                 82% |
| derStandard agriculture excerpt              | German   |        4 |      1,272 | 76.4 s         |       60.0 |                 75% |
| Pi 1.0 (local, first run)                    | English  |        5 |      1,154 | 74.8 s         |       64.8 |                 81% |
| Pi 1.0 (local, second run, more headings)    | English  |       14 |      2,752 | 177.5 s        |       64.5 |                 80% |
| derStandard xAI (local, two runs)            | German   |        3 |        681 | 44.6 s, 43.5 s | 65.4, 63.9 |            82%, 80% |
| derStandard Kühlgeräte (local)               | German   |        3 |        673 | 41.1 s         |       61.1 |                 76% |
| derStandard quiz (local)                     | German   |        3 |        486 | 32.2 s         |       66.3 |                 83% |

**The pace changed with policy 5.** The prototype synthesized the same 11 texts with both request shapes, two takes each. Pooled over those paired clips, the policy-5 shape produced 72.2 ms/char against 63.9 for English (+13%) and 72.0 against 66.2 for German (+9%). The other variants that add a style annotation are similarly slow (70.7–73.7), and the language code alone sits between (67.0–67.1), so the style annotation appears to slow Charon down. Two takes per cell cannot separate a small effect from take-to-take variation, which reached 7% for running text and 26% for one heading between takes of the same text and request (German title at policy 4: 77.7 and 98.0 ms/char). Applying the +9–13% to the policy-4 article totals above gives about 66–74 ms/char for a policy-5 article, consistent with the 72 ms/char measured directly.

## What skews the ratio

- **Fixed overhead per segment.** A straight-line fit of audio against characters over all Flash-Lite clips except names-only ones gives about 1.3 s plus 57 ms per character at policy 4, and about 0.7–1.2 s plus 63–66 ms per character at policy 5 (only 19 clips). The intercept is lead-in and trailing silence plus heading intonation, so short segments read slowly per character. The extremes are local headings: "Pi 1.0" (6 characters) took 2.06 s and 1.97 s, 330–344 ms/char, and "Earendil <rfc@earendil.com>" (27 characters) took 2.7–3.9 s. These exceed the reservation's one-second minimum, while segments over about 200 characters stay at 57–74 ms/char (median 62).
- **Headings.** A heading on its own runs 80–90 ms/char; a heading joined with following body by a blank line adds the pause and lands at 65–75 ms/char for the whole segment. Articles with many short headings, like the second Pi 1.0 run with nine heading-only segments of 6 to 79 characters, still came to 80% of the reservation because one 1,029-character body segment dominated.
- **Names-only segments.** The German byline "Gerald John, Alicia Prager, Sandra Schieder" (43 characters) took 4.2–5.3 s across all request shapes, 97–123 ms/char, and 106–109 ms/char at policy 5, the highest of any kind. The English byline "Gerald John and Sandra Schieder in Vienna" took 76–88 ms/char. Names are read with pauses between them, and a short segment carries the fixed overhead.
- **Numbers.** No measurable effect in running text: Flash-Lite body segments containing digits ran 60–61 ms/char against 62–64 without, across 8 segments with digits. Digit strings usually expand into more spoken syllables than characters ("215,000+", "2026"), so a number-heavy text could read slower, but none of the samples was number-heavy. The slowest heading-with-body segment (91.4 ms/char) was "Collect tasks for the initial eval dataset / Step 0. Start early".
- **Language.** English and German running text read at the same rate within 2 ms/char under both policies. No other narration language has archived Flash-Lite audio.

## Other models

Same 12 chunks (policy-4-shape requests for the 3.8 models), pooled ms per character from the [Gemini 3.8 comparison](gemini-3.8-tts-comparison.md):

| Model                                     | Voice         | English | German |
| ----------------------------------------- | ------------- | ------: | -----: |
| `gemini-3.8-flash-lite-tts`               | Charon        |    63.3 |   60.0 |
| `gemini-3.8-flash-tts`                    | Charon        |    65.7 |   60.2 |
| `gemini-3.1-flash-tts-preview` (policy 3) | Charon        |    69.5 |   66.7 |
| `eleven_v3`                               | George        |    74.5 |   63.4 |
| Speechify `simba-3.2` / `simba-3.0`       | Alec / Moritz |    84.8 |   54.1 |

The Speechify figures are the excerpt totals from that note's audio table (189.3 s for 2,232 English characters, 68.8 s for 1,272 German). The configured ElevenLabs voice in `ELEVENLABS_SPEECH_CONFIG` is now Lawrence, not George, so its rate today is unmeasured.

## Limits

- **The policy-5 sample is small:** 22 prototype clips of 11 texts (two of them joins of others) plus 2 probe clips of one more text, two takes each, all synthesized on one day. The texts are short (41–251 characters), so they overweight headings and bylines and contain no segment near the 2,000-character chunk maximum. Treat 70 ms/char for policy-5 articles as ±5 ms.
- **Synthesis is not deterministic.** Takes of the same request differed by up to 26% for short segments and up to 7% for running text.
- **No production data.** Segment durations of policy-5 conversions in production would settle the baseline far better than this sample; querying them needs production access.
- **Two languages only.** French and other Flash-Lite languages have no archived audio.
- **Measurement differences.** The prototype's MP3s include encoder padding; the paired comparison is unaffected because both shapes share it, but its absolute values may run a few ms/char high on the shortest clips.

## Implications for the pace prototype and the reservation

- The baseline to beat is policy 5 at about **68–70 ms/char for running text and 70–73 ms/char for whole segments in English and German**, not the faster policy-4 figures that most archived audio shows. A pace prototype should measure its own policy-5 control in the same run, since take-to-take variation is as large as the pace effect being sought.
- At today's pace, 80 ms/char over-reserves an article by roughly 10–15%. A faster pace widens that margin. A per-segment fixed term (about 1 s) plus a smaller per-character rate would fit short segments better than the flat rate with a one-second minimum, but no sample shows an article whose total audio exceeded its reservation.
- Segments that exceed their own reservation are names-only bylines and very short headings. Settlement charges such an overrun from the available duration (`Math.min(actual, balance.available + balance.reserved)` in `libs/duration-ledger/src/duration-ledger.ts`), so it is charged, not lost.

## Reproduce

The [analysis archive](narration-characters-to-duration.tar.xz) contains `analyze.mjs` and its full output, including one row per Flash-Lite clip. It reads extracted research archives and copies of the local Miniflare SQLite files, and it makes no API calls. Extract each research archive into its own directory, copy the Durable Object and R2 SQLite files out of `apps/web-app/.wrangler/state/v3` (the originals may be locked by a running dev server), and run:

```sh
node analyze.mjs <extracted-archives-dir> <durable-object-sqlite-copies> <r2-sqlite-copies> <path to apps/web-app/.wrangler/state/v3/r2/create-audiobook-from-url-audio/blobs>
```

It needs Node, `ffprobe` and `sqlite3`.
