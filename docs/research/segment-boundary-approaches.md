# PROTOTYPE verdict: segment boundary approaches

> Historical prototype verdict, incorporated 2026-11-14. Its blind A/B is the rationale of [ADR 0027](../adr/0027-flow-narration-across-segment-boundaries-with-overlap-and-cut.md), which built overlap and cut as speech policy 7 in [#336](https://github.com/patricktree/cup/pull/336), deployed on 2026-11-13; [ADR 0028](../adr/0028-withdraw-overlap-and-cut.md) withdrew it in [#352](https://github.com/patricktree/cup/pull/352), merged and deployed on 2026-11-14, because Whisper's word timing put the cut point in the wrong place, and the effort continues on the map [Map: decouple speech synthesis from synchronization units](https://github.com/patricktree/cup/issues/320). The build differed from the candidate heard here: it spoke only the previous narration chunk's last sentence in front, nothing after the chunk, and searched for the cut point between the aligned words instead of a 0.25 s window around Whisper's word gap ([Overlap-and-cut aligner](overlap-cut-aligner.md)). The diagnosis before it is [Segment boundary diagnosis](segment-boundary-diagnosis.md). The scripts, listening page, audio, `summary.json` and `answers.md` are the [prototype archive](segment-boundary-approaches.tar.xz).

[Original prototype](https://github.com/patricktree/cup/tree/50de4acb0023b6baec3e6d3448bd7cd9d12ee7ad/libs/audiobook-production/prototype-segment-boundary-approaches), verdict in `README.md`.

Throwaway branch `prototype/segment-boundary-approaches`, never merged. Answers [Which approach makes segment boundaries inaudible?](https://github.com/patricktree/cup/issues/291) for the map [Map: narration flows across segment boundaries](https://github.com/patricktree/cup/issues/288).

## Candidates

Every segment was synthesized on its own on 2026-11-13 through Cloudflare AI Gateway with the production request shape (Gemini 3.8 Flash-Lite TTS, Charon, narration language and its style annotation, `audio/l16` at 24 kHz), stretched with Sonic ×1.05 and encoded as policy 6 does, then joined byte for byte. The runs are the diagnosis runs that were judged: Anthropic 91–96, derStandard 8–12 and the derStandard chunk 13 split, 13 segments and 10 segment boundaries.

- **Policy 6** (`p6`), as it was, the blind control.
- **Continuity style** (`style`): the language style followed by "Carry on reading mid-article in one steady narrating voice."
- **Unspoken context** (`ctx`): the previous and next narration chunk in the same text block, with the undocumented `speech_metadata` `start_index`/`end_index` byte range on this chunk only ([Gemini TTS unspoken context](gemini-tts-unspoken-context.md)).
- **Unspoken context and continuity style** (`ctxstyle`).
- **Overlap and cut** (`overlap`): the previous chunk's last sentence, this chunk and the next chunk's first sentence spoken in one request. Whisper large v3 turbo on Workers AI transcribed the provider audio with word timestamps, its words were aligned with the block's by longest common subsequence, and the cut went in the middle of the longest silence below −45 dBFS in the largest inter-word gap at each chunk edge, before the Sonic stretch. Each side kept half the model's own pause, so the joins paused for 790–1,270 ms.

Each take also existed loudness-evened, at −19 LUFS integrated per segment. The listening page labelled the candidates A to E in a different order per boundary.

## What was heard

Listened to by Patrick on 2026-11-13, blind, all 10 segment boundaries judged:

| Boundary            | Kind                                       | Flows                    | Best     |
| ------------------- | ------------------------------------------ | ------------------------ | -------- |
| Anthropic 91 → 92   | paragraph → heading-led segment            | overlap, p6              | overlap  |
| Anthropic 92 → 93   | paragraph → heading-only segment           | overlap, ctx             | overlap  |
| Anthropic 93 → 94   | heading- or title-only segment → paragraph | style, ctxstyle, overlap | overlap  |
| Anthropic 94 → 95   | paragraph → step title as its own segment  | p6, overlap              | overlap  |
| Anthropic 95 → 96   | heading- or title-only segment → paragraph | ctxstyle, style, ctx     | ctx      |
| derStandard 8 → 9   | paragraph → paragraph                      | ctxstyle, overlap        | overlap  |
| derStandard 9 → 10  | paragraph → heading-led segment            | overlap, p6, ctx         | ctx      |
| derStandard 10 → 11 | paragraph → paragraph                      | overlap, ctx, style      | overlap  |
| derStandard 11 → 12 | paragraph → paragraph                      | overlap, style, ctxstyle | ctxstyle |
| derStandard 13 → 14 | mid-paragraph split                        | overlap, style, p6       | overlap  |

At derStandard 9 → 10 the operator noted that loudness or pitch seemed to rise in the overlap take. Loudness evening was heard last and made no difference.

Verdict: overlap and cut is the only candidate that clearly beats speech policy 6. It flowed at 9 of 10 segment boundaries and was picked best at 7, across every boundary kind; the one jump was step title → paragraph (Anthropic 95 → 96). Policy 6 flowed at 4 of 10, unspoken context at 4, the continuity style at 5 and both together at 4, so none of them is distinguishable from the control. Whisper heard no skipped or repeated word at any edge once the cut aligned word by word; a first character-count aligner misplaced 2 of 26 cuts on numbers that Whisper writes differently from the text.

## Cost

On these 13 segments the requests synthesized 395 s of provider audio to keep 244 s: 1.62 times the audio, from 1.06 for a 659-character paragraph to 4.16 for a 49-character step title. Audio output is about 99% of synthesis cost, so synthesis costs roughly that factor more, plus one Whisper pass over the provider audio.

## Reproduction

Unpack with `tar -xJf docs/research/segment-boundary-approaches.tar.xz -C libs/audiobook-production` from the repository root, since the scripts import workspace packages and read the eval fixtures relative to that folder. The archive holds `render.mjs` (65 paid synthesis calls and Whisper passes, five candidates per segment, run from `libs/audiobook-production` as `node prototype-segment-boundary-approaches/render.mjs <env-file> <out-dir>`), `build-page.mjs` (joins, measures every boundary and checks each segment's edge words against Whisper; needs `ffmpeg`), `make-html.mjs` (the blind listening page in `page/`), `summary.json` (per segment and candidate the usage, cut points, loudness, edge silence and transcript; per boundary the gap, level and pitch steps) and `answers.md`. Open `page/index.html` to listen. The scripts ran against the code at the original commit.
