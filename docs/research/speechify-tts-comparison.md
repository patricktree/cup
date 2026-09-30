# Speechify, Eleven v3, and Gemini TTS comparison

Completed on 2026-09-24. All 12 Speechify requests succeeded, generating 258.1 seconds of audio in 17.8 seconds of sequential synthesis time. Estimated synthesis usage is at most $0.03504, before free or included credits. Speechify is a promising candidate for listening review; this experiment does not establish a subjective quality winner. The application configuration is unchanged: Gemini with Charon remains selected.

## Method

Reuse the exact 12 narration chunks from the [Eleven v3 comparison](./eleven-v3-tts-comparison.md): Anthropic indices 93–96, Cloudflare 57–60, and derStandard 9–12, totaling 3,504 characters. The archived source excerpts, Gemini audio, ElevenLabs audio, machine transcripts, and per-request measurements have been copied into the comparison directory without regenerating them. Content selection is not rerun. Baseline voices are Eleven v3 with George and Gemini with Charon, as recorded in that experiment.

Speechify used `simba-3.2` with Alec (`alec`, `en-GB`) for the two English excerpts and `simba-3.0` with Moritz (`moritz`, `de-DE`) for German. Alec's catalog tags include British, nonfiction, and audiobooks; Moritz's include relaxed delivery and audiobooks. Their model and locale compatibility was verified against the authenticated catalog. These were initial stock voice choices, not the result of a voice audition. Simba 3.2 is English only. [Models](https://docs.speechify.ai/build/guides/concepts/models), [voice catalog](https://docs.speechify.ai/build/api-reference/v1/voices/get).

The harness sends unchanged plain text directly to Speechify's streaming endpoint, sequentially, with no automatic retries and a 90-second request timeout. It requests signed 16-bit little-endian mono PCM at 24 kHz, then uses FFmpeg for the listening MP3s. This matches the existing comparison's audio representation. Speechify documents this PCM layout for `Accept: audio/pcm`, returned as `audio/L16`. [Streaming API](https://docs.speechify.ai/build/api-reference/v1/audio/stream).

Measurements include client time to the first nonempty audio chunk and completion of the full PCM response, excluding MP3 encoding. Results retain request IDs, server timing headers, model, voice, language, input text, duration, and HTTP status. Baseline timings were recorded on 2026-09-23 through Cloudflare AI Gateway; Speechify used a direct connection on a different date. These measurements describe this experiment, not a controlled provider latency ranking.

## Measurements

| Fixture excerpt         | Characters | Speechify generation | Eleven v3 generation | Gemini generation | Speechify audio | Speechify usage estimate |
| ----------------------- | ---------: | -------------------: | -------------------: | ----------------: | --------------: | -----------------------: |
| Anthropic agent evals   |      1,141 |                7.1 s |               30.4 s |            37.7 s |          90.3 s |                ≤$0.01141 |
| Cloudflare Kitesurf     |      1,091 |                6.1 s |               29.2 s |            38.5 s |          99.0 s |                ≤$0.01091 |
| derStandard agriculture |      1,272 |                4.6 s |               35.7 s |            39.9 s |          68.8 s |                ≤$0.01272 |
| Total                   |      3,504 |               17.8 s |               95.4 s |           116.1 s |         258.1 s |                ≤$0.03504 |

Speechify client time to first audio ranged from 0.25 to 1.12 seconds, with a median of 0.30 seconds. The earlier comparison did not record this metric. Complete-response generation was about 5.3 times faster than the archived Eleven v3 run and 6.5 times faster than Gemini. Different routes, dates, voices, and speaking durations limit this comparison; one run per chunk is not a stable benchmark.

The English Speechify audio was longer than both archived alternatives (90.3 and 99.0 seconds versus ElevenLabs' 80.2 and 86.1, and Gemini's 75.5 and 79.7). German was shorter (68.8 seconds versus 80.6 and 84.8). Listen for whether that pacing suits the content; generation speed alone does not measure delivery quality.

## Cost

The published Starter usage rate is $10 per million characters, giving an upper-bound usage estimate of $0.03504 for this sample. Speechify excludes whitespace and SSML tags from billing, and free or included usage may cover the requests. The harness reserves against all input characters and stops before exceeding $0.10 in synthesis requests per run. Free currently includes 500,000 characters/month; Starter is $10/month with 1.9 million characters included, then $10 per million. No subscription purchase is needed to prepare the experiment. [Pricing](https://speechify.ai/pricing).

Three Cloudflare Whisper transcription requests completed. At the published $0.000513 per audio minute, the 4.30 minutes of audio adds approximately $0.00221, for total new experimental usage of approximately $0.03725 before credits. These are list-price estimates, not invoice totals. The archived ElevenLabs and Gemini usage estimates were $0.350 and $0.121 respectively; those providers were not called again. [Whisper pricing](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/).

## Content and listening review

Whisper used VAD, disabled previous-text conditioning, and an explicit language, matching the earlier screening. Its transcripts contain no obvious missing sentences across the three excerpts. Technical abbreviations, numeric comparisons, and Ferdinand Lembacher's name appear in the outputs. This is automated screening, not proof of exact spoken fidelity.

Listen to these specific discrepancies before attributing them to synthesis rather than recognition: the Anthropic transcript renders “80/20” as “80 20th,” one “evals” as “evils,” and “you're reverse-engineering” as “you'll reverse engineering.” The Cloudflare transcript renders “e.g.” as “for Xe.” The German transcript renders “spendabler” as “Spenderblär.” The original ElevenLabs transcript also had a discrepancy around “you're reverse-engineering,” so this phrase is useful for direct comparison.

Naturalness, accent, pronunciation, and continuity across chunk boundaries remain for human listening review. All nine clips and their machine transcripts are available in the listening page.

## Artifacts and execution

The [research archive](./speechify-tts-comparison.tar.xz) contains `listen.html` with all nine clips embedded, source excerpts, baseline and new measurements, PCM and MP3 files, transcripts, the voice/model catalog snapshots, the selected configuration, and three standalone Node scripts. No credentials are included. Node and FFmpeg are sufficient; repository dependencies are not needed for this experiment. Unpack it from the repository root to inspect or reproduce the experiment:

```sh
tar -xJf docs/research/speechify-tts-comparison.tar.xz -C docs/research
```

Then open `docs/research/speechify-tts-comparison/listen.html`. Playback and page regeneration incur no API charges. Rerunning synthesis or transcription does.

Set `SPEECHIFY_API_KEY` in an ignored local environment file. Do not put credentials in the comparison directory. From the repository root, fetch the catalog without generating audio:

```sh
SPEECHIFY_ENV_FILE=/absolute/path/to/credentials.env node docs/research/speechify-tts-comparison/run.mjs catalog
```

The saved `config.json` records the tested voices; `config.example.json` documents the structure for a new experiment. For another run, use a separate output directory containing the scripts, source excerpts, baseline artifacts, and configuration, without the previous `results.json`. Then run synthesis, transcription, and page generation there. The original commands were:

```sh
SPEECHIFY_ENV_FILE=/absolute/path/to/credentials.env node docs/research/speechify-tts-comparison/run.mjs synthesize
CLOUDFLARE_ENV_FILE=/absolute/path/to/cloudflare.env node docs/research/speechify-tts-comparison/transcribe.mjs
node docs/research/speechify-tts-comparison/make-listening-page.mjs
```

The synthesis script refuses to overwrite `results.json`, preventing an accidental repeat charge. Inspect any failed run before deciding whether another experiment is warranted.

## Validation

Node syntax checks passed for the experiment scripts. Live authentication, paginated catalog retrieval, 12 streamed PCM responses, MP3 encoding, and three transcription requests succeeded. All Speechify responses declared `audio/L16;rate=24000;channels=1`. The listening-page generator loaded all nine MP3s and transcripts; FFmpeg verified the MP3 files as 24 kHz mono and decoded them without errors. Copied baseline artifacts and the packed archive were verified byte-for-byte. Markdown lint and formatting checks passed for the report and scripts. No production code was changed or deployed; the production validation suites were not run for this standalone experiment.
