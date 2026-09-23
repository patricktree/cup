# Eleven v3 and Gemini TTS comparison

On 2026-09-23, configure ElevenLabs `eleven_v3` with the stock George voice (`JBFqnCBsd6RMkjVDRZzb`) as the backend default. Gemini `gemini-3.1-flash-tts-preview` with Charon remains implemented. Switch back by assigning `GEMINI_SPEECH_CONFIG` to `SPEECH_CONFIG` in `libs/audiobook-production/src/speech-synthesis-config.ts` and redeploying. There is no user-facing choice or automatic provider fallback.

Requests use the default Cloudflare AI Gateway and its stored provider credentials. ElevenLabs receives unchanged narration text, stability 0.5, and requests for 24 kHz signed 16-bit mono PCM. The existing MP3 encoder and synchronization pipeline remain in use. A durable workflow step records the synthesis configuration before producing segments; stored segment identities prevent incompatible reuse and mixed-provider assembly. Completed Gemini audiobooks remain exportable. A pre-existing conversion resumes its stored configuration when segment zero is available; incompatible partial segments fail rather than silently mixing providers.

## Method

The three original eval articles contain 63,809 characters. A full Eleven v3 run alone would cost approximately $6.38 at the published rate, exceeding the approved $5 comparison budget. This initial comparison therefore uses four consecutive synchronization units from the middle of each existing fixture: Anthropic indices 93–96, Cloudflare 57–60, and derStandard 9–12 (zero-based). Both providers receive the same 3,504 characters across 12 requests. Content selection is not rerun.

Each synthesis request runs sequentially with streaming enabled, caching bypassed, and no retries. Generation time measures the complete PCM response, excluding MP3 encoding; it is not the eight-way concurrent production workflow's elapsed time. An additional 49-character ElevenLabs request verified the non-streaming retry endpoint. Both request modes succeeded through the configured gateway. The listening files use FFmpeg to encode returned PCM; the production encoder is separately exercised by unit and application E2E tests.

## Measurements

| Fixture excerpt         | Characters | Eleven v3 generation | Gemini generation | Eleven v3 audio | Gemini audio | Eleven v3 estimate | Gemini estimate |
| ----------------------- | ---------: | -------------------: | ----------------: | --------------: | -----------: | -----------------: | --------------: |
| Anthropic agent evals   |      1,141 |               30.4 s |            37.7 s |          80.2 s |       75.5 s |             $0.114 |          $0.038 |
| Cloudflare Kitesurf     |      1,091 |               29.2 s |            38.5 s |          86.1 s |       79.7 s |             $0.109 |          $0.040 |
| derStandard agriculture |      1,272 |               35.7 s |            39.9 s |          80.6 s |       84.8 s |             $0.127 |          $0.043 |
| Total                   |      3,504 |               95.4 s |           116.1 s |         247.0 s |      240.0 s |             $0.350 |          $0.121 |

Eleven v3 completed this sample about 18% faster in aggregate, at approximately 2.9 times the estimated synthesis cost. This is one run per excerpt, not a statistically stable latency benchmark or a long-article quality evaluation.

ElevenLabs estimates use [$0.10 per 1,000 characters](https://elevenlabs.io/pricing/api). Gemini estimates use [$20 per million audio tokens at 25 tokens/second and $1 per million input text tokens](https://ai.google.dev/gemini-api/docs/pricing), approximating input tokens as characters divided by four. These are list-price estimates, not invoice totals. Including the initial smoke request, the non-streaming check, and transcription experiments, estimated spend is approximately $0.50, below the approved $5 cap.

## Content and listening review

Cloudflare-hosted [Whisper large v3 turbo](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) transcribed all six excerpts with voice activity detection enabled and previous-text conditioning disabled. The initial unfiltered transcripts contained spurious trailing text; enabling those options removed it. The configured ElevenLabs key denied speech-to-text permission, so no ElevenLabs transcription completed.

The final transcripts contain no obvious missing sentences in either provider's samples. Technical acronyms, Austrian names, and numeric comparisons appear in both transcripts. This is an automated screening result, not proof of exact spoken fidelity. Whisper rendered the Anthropic Eleven v3 phrase “you're reverse-engineering” as “you'll reverse engineering”; this needs listening to distinguish recognition error from synthesis. Punctuation, spelling, and spoken-number normalization also differ between transcripts.

Naturalness, accent, pronunciation, and continuity across chunk boundaries remain for human listening review. The implementation follows the requested Eleven v3 default without claiming it has won a subjective quality comparison.

The colocated [research archive](./eleven-v3-tts-comparison.tar.xz) contains the listening page (`listen.html`), source excerpts, per-request measurements (`results.json`), PCM and MP3 files, Whisper transcripts, and the one-off Node scripts used for the experiment. Lossless xz compression reduces the 88-file record from 73.3 MB to 36.6 MB; every extracted file was verified byte-for-byte. The scripts read credentials from the ignored local environment file; no credentials are included. They require the accompanying ElevenLabs implementation, and running synthesis or transcription again incurs provider charges.

To unpack the archive at the paths expected by the experiment scripts, run this from the repository root, then open `docs/research/eleven-v3-tts-comparison/listen.html`:

```sh
tar -xJf docs/research/eleven-v3-tts-comparison.tar.xz -C docs/research
```

## Validation

`pnpm validate:fast` passed, including type checks, lint, existing tests, and 52 browser component tests. `pnpm test:e2e:app` passed all 44 application E2E tests. Added tests cover ElevenLabs request modes, transient and permanent failures, invalid PCM, synthesis identity conflicts, legacy Gemini validation, and refusal to assemble mixed providers. The application E2E suite uses deterministic provider responses; the paid comparison separately exercised the real gateway and providers. Production deployment was not performed.
