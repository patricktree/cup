# PROTOTYPE verdict: segment boundary diagnosis

> Historical prototype verdict, incorporated 2026-11-14. It is the diagnosis behind [ADR 0027](../adr/0027-flow-narration-across-segment-boundaries-with-overlap-and-cut.md), which built overlap and cut as speech policy 7 in [#336](https://github.com/patricktree/cup/pull/336), deployed on 2026-11-13; [ADR 0028](../adr/0028-withdraw-overlap-and-cut.md) withdrew it in [#352](https://github.com/patricktree/cup/pull/352), merged and deployed on 2026-11-14, because Whisper's word timing put the cut point in the wrong place. The fresh starts this page diagnoses are back in every narration track, and the effort continues on the map [Map: decouple speech synthesis from synchronization units](https://github.com/patricktree/cup/issues/320). The approaches heard next are in [Segment boundary approaches](segment-boundary-approaches.md). The scripts, listening page, audio, `summary.json` and `answers.md` are the [prototype archive](segment-boundary-diagnosis.tar.xz).

[Original prototype](https://github.com/patricktree/cup/tree/9d9d3372b9692dffb3f541697c958ffa4809116f/libs/audiobook-production/prototype-segment-boundaries), verdict in `README.md`.

Throwaway branch `prototype/segment-boundaries`, never merged. Answers [Where and why do segment boundaries sound like a fresh start?](https://github.com/patricktree/cup/issues/290) for the map [Map: narration flows across segment boundaries](https://github.com/patricktree/cup/issues/288).

## Method

Five runs of consecutive narration chunks from the `libs/narration-source-analysis` eval fixtures: Anthropic 91–96, Cloudflare 56–60 and derStandard 8–12, plus Anthropic chunk 99 and derStandard chunk 13 split at the sentence nearest their middle, standing in for an oversized narration block (no fixture block exceeds 2,000 characters). Each chunk went through the production `produceAudioSegment` (Gemini 3.8 Flash-Lite, Charon, speech policy 6, Sonic ×1.05) through Cloudflare AI Gateway on 2026-11-12, and each run's segment MP3s were joined byte for byte as the narration track joins them. Each run was also synthesized as one request, its chunks joined with blank lines, as a continuous reference: 25 requests, 12,424 characters.

Measured per segment boundary: the silence at the join below −45 dBFS (including about 50 ms of MP3 padding), each side's edge silence, the step in mean speech power between the last 3 s before and the first 3 s after, and the step in median autocorrelation F0 between the last 2 s before and the first 2 s after. The same was measured at the matching pause of the continuous take. `summary.json` holds every measurement.

Unpack with `tar -xJf docs/research/segment-boundary-diagnosis.tar.xz -C libs/audiobook-production` from the repository root, since the scripts import `@cup/audiobook-production` and read the eval fixtures relative to that folder. Rerun with `node prototype-segment-boundaries/render.mjs <env-file> <out-dir>` from `libs/audiobook-production` (paid, 25 Gemini 3.8 Flash-Lite TTS calls), then `build-page.mjs` and `make-html.mjs` (both need `ffmpeg`), and open `page/index.html`. The scripts ran against the code at the original commit.

## What was heard

Listened to by Patrick on 2026-11-13, 10 of 15 segment boundaries judged; the 4 Cloudflare boundaries and the English split were skipped:

| Run                        | Boundary | Kind                                       | What jumped                    | Fresh start    |
| -------------------------- | -------- | ------------------------------------------ | ------------------------------ | -------------- |
| Anthropic 91–96            | 91 → 92  | paragraph → heading-led segment            | energy, intonation             | either is fine |
| Anthropic 91–96            | 92 → 93  | paragraph → heading-only segment           | energy, intonation             | wrong          |
| Anthropic 91–96            | 93 → 94  | heading- or title-only segment → paragraph | energy, intonation             | wrong          |
| Anthropic 91–96            | 94 → 95  | paragraph → step title as its own segment  | intonation                     | wrong          |
| Anthropic 91–96            | 95 → 96  | heading- or title-only segment → paragraph | intonation, voice timbre       | wrong          |
| derStandard 8–12           | 8 → 9    | paragraph → paragraph                      | energy, intonation, loudness   | –              |
| derStandard 8–12           | 9 → 10   | paragraph → heading-led segment            | intonation, voice timbre       | wrong          |
| derStandard 8–12           | 10 → 11  | paragraph → paragraph                      | energy, loudness, voice timbre | –              |
| derStandard 8–12           | 11 → 12  | paragraph → paragraph                      | energy                         | –              |
| derStandard chunk 13 split | 13 → 14  | mid-paragraph split                        | intonation                     | –              |

Verdict: every judged segment boundary jumps, and the jump is prosody, not the pause. Intonation jumped at 8 of 10 and energy at 7, voice timbre (a different-sounding take) at 3, and loudness at 2, both German paragraph-to-paragraph boundaries. Pause length was never ticked: the joins already pause for 570–850 ms, less than the 680–1,170 ms the model pauses between paragraphs in one continuous request. A fresh start is wrong at 6 of the 7 heading and step-title boundaries and "either is fine" at the remaining one, so no heading boundary needs to keep sounding like a fresh start.
