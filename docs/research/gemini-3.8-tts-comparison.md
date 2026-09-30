# Gemini 3.8 Flash, Flash-Lite, and existing TTS comparison

Completed on 2026-09-30. All 24 new synthesis requests succeeded through Cloudflare AI Gateway. Gemini 3.8 Flash generated 223.2 seconds of audio in 123.7 seconds of sequential synthesis time; Flash-Lite generated 217.6 seconds in 73.9 seconds. Flash-Lite was about 40% faster in this run. The listening page contains all 15 clips: three identical excerpts rendered by Gemini 3.1, ElevenLabs, Speechify, Gemini 3.8 Flash, and Gemini 3.8 Flash-Lite. No subjective quality winner has been selected, and production configuration is unchanged.

## Method

Reuse the exact 12 narration chunks from the [Speechify comparison](./speechify-tts-comparison.md) and [Eleven v3 comparison](./eleven-v3-tts-comparison.md): Anthropic indices 93–96, Cloudflare 57–60, and derStandard 9–12 (zero-based), totaling 3,504 characters. The nine existing MP3s, machine transcripts, source excerpts, and baseline measurements were copied from the Speechify archive without regenerating audio or rerunning narration content selection. The 23 copied baseline audio, transcript, source, and measurement files were verified byte-for-byte against that archive.

| Listening option      | Model                                           | Voice                            | Recorded   | Route                 |
| --------------------- | ----------------------------------------------- | -------------------------------- | ---------- | --------------------- |
| Gemini 3.1            | `gemini-3.1-flash-tts-preview`                  | Charon                           | 2026-09-23 | Cloudflare AI Gateway |
| ElevenLabs            | `eleven_v3`                                     | George                           | 2026-09-23 | Cloudflare AI Gateway |
| Speechify             | `simba-3.2` for English; `simba-3.0` for German | Alec (`en-GB`); Moritz (`de-DE`) | 2026-09-24 | Direct Speechify API  |
| Gemini 3.8 Flash      | `gemini-3.8-flash-tts`                          | Charon                           | 2026-09-30 | Cloudflare AI Gateway |
| Gemini 3.8 Flash-Lite | `gemini-3.8-flash-lite-tts`                     | Charon                           | 2026-09-30 | Cloudflare AI Gateway |

Both new models receive unchanged narration text in structured `user_input` text content, without the legacy instruction wrapper, style direction, speaker labels, or inline vocal tags. The Interactions API treats 3.8 input as a verbatim transcript. Each request explicitly selects Charon and `response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24000 }`. This avoids the new WAV default for non-streaming requests. [Migration and model guidance](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts), [audio output formats](https://ai.google.dev/gemini-api/docs/speech-generation#audio-output-formats).

Synthesis runs sequentially, with streaming enabled, caching bypassed, no automatic retries, a 90-second timeout, and payload logging disabled. All 24 requests returned HTTP 200, declared 24 kHz mono Linear PCM, and ended with `interaction.completed`. The harness records model, voice, exact input, synchronization unit ID, gateway log ID, first audio time, complete-response time, PCM duration, event types, and provider usage counters. FFmpeg encodes listening MP3s at 128 kbps. New excerpt MP3s are encoded from concatenated PCM rather than concatenating separately encoded MP3s; archived clips remain unchanged.

Generation time ends when the full PCM response is consumed and excludes MP3 encoding, transcription, and archive creation. Different dates, routes, voices, durations, and request formulations limit comparisons against the archived providers. The two 3.8 models share the same route, voice, and input formulation, but this is still one run per chunk in a fixed order, not a statistically stable benchmark. The excerpts do not test complete articles or the current 2,000-character chunk maximum; the largest sampled chunk is 659 characters.

## Measurements

| Fixture excerpt         | Characters | Gemini 3.1 generation | Eleven v3 generation | Speechify generation | 3.8 Flash generation | 3.8 Flash-Lite generation |
| ----------------------- | ---------: | --------------------: | -------------------: | -------------------: | -------------------: | ------------------------: |
| Anthropic agent evals   |      1,141 |                37.7 s |               30.4 s |                7.1 s |               39.4 s |                    23.7 s |
| Cloudflare Kitesurf     |      1,091 |                38.5 s |               29.2 s |                6.1 s |               43.1 s |                    23.6 s |
| derStandard agriculture |      1,272 |                39.9 s |               35.7 s |                4.6 s |               41.3 s |                    26.5 s |
| Total                   |      3,504 |               116.1 s |               95.4 s |               17.8 s |              123.7 s |                    73.9 s |

| Fixture excerpt         | Gemini 3.1 audio | Eleven v3 audio | Speechify audio | 3.8 Flash audio | 3.8 Flash-Lite audio |
| ----------------------- | ---------------: | --------------: | --------------: | --------------: | -------------------: |
| Anthropic agent evals   |           75.5 s |          80.2 s |          90.3 s |          68.2 s |               69.5 s |
| Cloudflare Kitesurf     |           79.7 s |          86.1 s |          99.0 s |          78.5 s |               71.8 s |
| derStandard agriculture |           84.8 s |          80.6 s |          68.8 s |          76.5 s |               76.4 s |
| Total                   |          240.0 s |         247.0 s |         258.1 s |         223.2 s |              217.6 s |

Flash-Lite generated slightly shorter audio overall than Flash (2.5%) while finishing about 40% sooner. Flash took about 6.6% longer than the archived 3.1 run. Speechify retains the shortest recorded generation time. These observations do not establish voice quality, fidelity, or production latency rankings.

Client time to first nonempty audio ranged from 4.08 to 17.18 seconds for Flash (median 10.33 seconds), and 2.96 to 9.66 seconds for Flash-Lite (median 6.13 seconds). First audio arrived close to completion for these gateway responses. This measures the client-visible gateway stream, not Google's internal time to first audio. The archived Speechify run recorded a 0.30-second median on its direct route; the older Gemini and ElevenLabs runs did not measure this metric.

## Cost

| Model                 | Duration-based synthesis estimate for this sample | Published audio output rate per million tokens, through 2026-12-31 |
| --------------------- | ------------------------------------------------: | -----------------------------------------------------------------: |
| Gemini 3.1            |                                          $0.12088 |                                                                $20 |
| Eleven v3             |                                          $0.35040 |                      Original estimate: $0.10 per 1,000 characters |
| Speechify             |                                         ≤$0.03504 |                      Original estimate: $10 per million characters |
| Gemini 3.8 Flash      |                                          $0.05065 |                                                                 $9 |
| Gemini 3.8 Flash-Lite |                                          $0.03308 |                                                                 $6 |

The new Gemini duration-based estimates apply Google's published approximation of 25 audio tokens per second, plus $0.50 per million input text tokens with characters divided by four as an approximation. From 2027-01-01, the published standard prices rise to $18 per million audio tokens for Flash, $12 for Flash-Lite, and $1 per million text input tokens for both. The archived estimates retain their original assumptions. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash-tts).

Provider-reported output counters were higher than 25 tokens per second in this run. Applying current published output rates to those counters, and charging all reported input tokens at the text rate, gives approximately $0.07992 for Flash and $0.05122 for Flash-Lite. Some input counters include audio tokens despite text-only submitted input, so this alternative calculation is illustrative rather than a reconciled bill. Raw counters are preserved in `gemini-results.json`. Neither method establishes the actual Cloudflare Gateway charge; the combined new synthesis estimate is $0.08373 by duration or $0.13114 using reported counters under those assumptions.

The harness reserves against each model's documented maximum of 16,384 output and 8,192 input tokens before sending a request, totaling $3.04742 of conservative synthesis reservations under its $4 guard. It creates the results file exclusively and refuses to repeat a synthesis run in a directory that already contains it. Reservations are limits, not measured usage. The three archived providers incurred no new synthesis charges.

## Listening review

Open the listening page to compare pronunciation, omissions, pace, naturalness, and continuity across the four original chunks in each excerpt. The source text is available below each group, and machine transcripts are attached to clips where screening succeeded. Playback pauses any other clip, so two providers do not overlap. The self-contained HTML embeds all 15 MP3s and works offline without API calls.

Review the Anthropic excerpt around “80/20” and “you're reverse-engineering”; both new machine transcripts render the latter as “you reverse engineering.” The same phrase had discrepancies in older screening, so listen before attributing this to synthesis. The Cloudflare excerpt is useful for `renderFrame()`, RPC, PNG, WPT, CSS, DOM, HTML, SVG, XHR, and numeric comparisons. The German excerpt is useful for Austrian names, agricultural terminology, and accent consistency.

Cloudflare Whisper large v3 turbo transcribed all six new excerpts with VAD enabled, previous-text conditioning disabled, and explicit English or German language. Its transcripts contain no obvious missing sentences. Both German samples include Ferdinand Lembacher's name and the original numeric comparisons; Flash's transcript renders singular “diese Zahl” as plural “diese Zahlen.” This screening does not prove exact spoken fidelity or establish subjective quality.

The first two Anthropic transcription requests used the original 24 kHz MP3s. Whisper rejected the Cloudflare Flash MP3 with HTTP 400 / code 3030 (“Failed to decode audio file”), and a 16 kHz WAV transport also failed. All listening files decoded locally without error. Re-encoding a separate transcription copy to 16 kHz mono MP3 at 64 kbps succeeded; the four remaining transcripts use that transport. The listening MP3s were not altered. Failed-attempt markers and transcription transport files are preserved. The six successful transcripts cover 7.35 minutes of audio, estimated at $0.00377 at the published $0.000513/minute rate; failed attempts are recorded but their billing is unknown. [Whisper model and pricing](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/).

## Artifacts and execution

The [research archive](./gemini-3.8-tts-comparison.tar.xz) contains `listen.html`, the nine reused baseline clips, six new excerpt clips, source text, per-chunk PCM and MP3 files, original measurements and transcripts, new gateway measurements, and standalone Node scripts. Credentials remain outside the artifact directory. Node and FFmpeg are sufficient; repository dependencies are not required to generate audio or regenerate the page.

Unpack the archive from the repository root:

```sh
tar -xJf docs/research/gemini-3.8-tts-comparison.tar.xz -C docs/research
```

Then open `docs/research/gemini-3.8-tts-comparison/listen.html`. Regenerating the page does not call APIs:

```sh
node docs/research/gemini-3.8-tts-comparison/make-listening-page.mjs
```

The new scripts are `synthesize-gemini.mjs` and `transcribe-gemini.mjs`. `run.mjs` and `transcribe.mjs` are preserved Speechify harnesses from the earlier experiment; do not run them to reproduce Gemini samples. To perform a fresh Gemini experiment, copy the scripts and required baseline files into a separate directory without `gemini-results.json`, new audio, or new transcription markers. Run the new scripts with a credentials file outside the output directory:

```sh
CLOUDFLARE_ENV_FILE=/absolute/path/to/cloudflare.env node docs/research/gemini-3.8-tts-comparison/synthesize-gemini.mjs
CLOUDFLARE_ENV_FILE=/absolute/path/to/cloudflare.env node docs/research/gemini-3.8-tts-comparison/transcribe-gemini.mjs
node docs/research/gemini-3.8-tts-comparison/make-listening-page.mjs
```

Synthesis and transcription incur provider charges. Transcription skips completed outputs and retains request markers; inspect a failed attempt before explicitly using `--retry-failed`. No production code was changed or deployed.

## Validation

All 30 new listening MP3s (24 per-chunk clips and six complete excerpts) decoded without errors and were verified as 24 kHz mono. The original nine listening MP3s, nine transcripts, three source files, and two measurement files match their archived originals byte-for-byte. The new harnesses and page generator passed Node syntax and formatting checks, and this report passed Markdown lint. The listening page was checked in the in-app browser for all 15 embedded audio players and transcripts. The packed archive was extracted into a temporary directory and verified byte-for-byte, and its contents were checked for local credentials. `pnpm validate:fast` also passed before committing the research results, covering environment configuration, formatting, build/type checks, lint, and existing tests.
