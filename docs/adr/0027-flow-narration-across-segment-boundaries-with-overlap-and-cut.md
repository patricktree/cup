---
status: accepted
---

# Flow narration across segment boundaries with overlap and cut

Each audio segment was synthesized from its narration chunk's text alone, so at almost every segment boundary the narration made a fresh start: the voice reset its intonation and energy, and sometimes sounded like a different take. The map [patricktree/cup#288](https://github.com/patricktree/cup/issues/288), answering Linear CUP-58, decided how narration carries on across segment boundaries in [#289](https://github.com/patricktree/cup/issues/289), [#290](https://github.com/patricktree/cup/issues/290), [#291](https://github.com/patricktree/cup/issues/291), [#316](https://github.com/patricktree/cup/issues/316), [#317](https://github.com/patricktree/cup/issues/317), [#318](https://github.com/patricktree/cup/issues/318) and [#319](https://github.com/patricktree/cup/issues/319), the spec [#330](https://github.com/patricktree/cup/issues/330) described it, and [#331](https://github.com/patricktree/cup/issues/331) to [#335](https://github.com/patricktree/cup/issues/335) implemented it as Gemini speech policy 7.

## Decision

- **Overlap and cut.** Every audio segment after the first is synthesized with the previous narration chunk's last whole sentence spoken in front of its own narration chunk, as one reading. Speech recognition finds the cut point, in the pause where the narration chunk starts, and everything before it is cut away. The model reads into the chunk from the sentence before it, so the segment starts mid-reading instead of fresh. In a blind A/B on 2026-11-13 the operator heard this flow at 9 of 10 boundaries, against 4 of 10 for policy 6 ([#291](https://github.com/patricktree/cup/issues/291)).
- **Segments stay independent.** A segment needs its neighbour's text, read from the manifest, never its audio, so segments still synthesize in parallel and retry one at a time.
- **Previous side only, one whole sentence, no special cases.** Nothing is spoken after the chunk, because the operator hears the problem at segment starts. The first segment gets no overlap. Overlap crosses headings and step titles like any other boundary, and a one-line previous chunk is overlapped whole. Across the eval fixtures this costs about 1.45× policy 6 per article, inside an accepted ceiling of about 2× including audio output ([#317](https://github.com/patricktree/cup/issues/317)).
- **Whisper large v3 turbo on Workers AI, word-aligned.** Gemini TTS returns no word timing ([#289](https://github.com/patricktree/cup/issues/289)). Whisper's words are aligned with the synthesized text's by longest common subsequence, and the cut lies in the longest silent run between the aligned words on either side of the chunk's start. It placed 116 of 116 researched cuts correctly at about 6% of synthesis cost; Gemini 3.5 Transcribe was as accurate at about ten times the cost, and silence alone placed only 100 ([#316](https://github.com/patricktree/cup/issues/316)).
- **A cut check, and a fallback that is never worse than today.** The cut point is accepted only when it lies between the overlap's last aligned word and the chunk's first, an aligned word sits at most two words from the chunk's start, and the cut lies in a silent run of at least 150 ms. Otherwise the same attempt synthesizes the narration chunk alone, as policy 6 does, with no second overlap take. A speech recognition error follows the provider-error rules and fails the segment rather than falling back silently. A narration language Whisper does not list gets no overlap for the whole conversion. No request sends a seed ([#318](https://github.com/patricktree/cup/issues/318)).
- **A new speech policy, not a change to policy 6.** Policy 7 is the deployment speech configuration; conversions prepared under policy 6 keep it for every remaining and retried segment, and existing audiobooks are not re-synthesized. Switching back is a one-line change of the speech configuration.

## Considered options

- **Unspoken neighbouring context**, the neighbouring chunks in the request with a `speech_metadata` byte range on the narration chunk only. Rejected: undocumented, and it flowed at 4 of 10 boundaries, no better than policy 6 ([#289](https://github.com/patricktree/cup/issues/289), [#291](https://github.com/patricktree/cup/issues/291)).
- **A continuity style** in `speech_metadata.style`, alone or with unspoken context. Rejected: 5 and 4 of 10 boundaries ([#291](https://github.com/patricktree/cup/issues/291)).
- **Loudness evening** per segment. Rejected: it made no audible difference ([#291](https://github.com/patricktree/cup/issues/291)). Edge-silence trimming and a deliberate pause were not candidates, since the joins already paused for less time than the model does between paragraphs ([#290](https://github.com/patricktree/cup/issues/290)).
- **Serial synthesis** chained on the previous segment's audio or state. Rejected: Gemini accepts text only, and an independent approach reached the bar ([#291](https://github.com/patricktree/cup/issues/291), [#319](https://github.com/patricktree/cup/issues/319)).
- **Grouping consecutive narration chunks** into one request. Rejected for now: it would cut the extra text from about ×1.39 to ×1.04–1.25, but needs several cut points per request, ties retries to groups, and was not heard ([#317](https://github.com/patricktree/cup/issues/317), [#319](https://github.com/patricktree/cup/issues/319)).
- **The Batch API** at half price. Rejected: hours of latency do not fit a conversion people read while it is synthesized ([#317](https://github.com/patricktree/cup/issues/317)).
- **Retrying the overlap take** after a cut failure, and a fixed seed for reproducible retries. Rejected: every researched cut held on the first take, the fallback is never worse than today, and seed determinism for TTS is unverified ([#318](https://github.com/patricktree/cup/issues/318)).

## Consequences

- Each segment after the first costs one Whisper run and more synthesized audio, and its step attempt may run two syntheses and one recognition, so the segment step's timeout grows from 2 to 5 minutes.
- Generated audio duration, and so the charge, is the cut segment's; the overlap that is cut away is never charged. The duration reservation ([ADR 0022](0022-reserve-70-milliseconds-of-audio-per-narration-text-character.md)) and the narration pace ([ADR 0023](0023-time-stretch-narration-audio-after-synthesis-with-sonic.md)) are unchanged.
- Narration languages Whisper does not list, 31 of Cup's 99, sound as they did under policy 6.
- Whether a stored segment was produced with overlap is not recorded; production logs show each fallback with its reason.
- The one jump the blind test still heard, step title into paragraph, gets no special case; production listening shows whether it matters.

## Evidence

- Boundary diagnosis: the unmerged branch `prototype/segment-boundaries` at [`9d9d3372`](https://github.com/patricktree/cup/tree/9d9d3372b9692dffb3f541697c958ffa4809116f/libs/audiobook-production/prototype-segment-boundaries), with its measurements in `summary.json` and the operator's answers in `answers.md`.
- Blind A/B of the approaches: the unmerged branch `prototype/segment-boundary-approaches` at [`50de4acb`](https://github.com/patricktree/cup/tree/50de4acb0023b6baec3e6d3448bd7cd9d12ee7ad/libs/audiobook-production/prototype-segment-boundary-approaches), with its measurements and transcripts in `summary.json` and the operator's answers in `answers.md`.
- Gemini capability research: [`gemini-tts-unspoken-context.md`](https://github.com/patricktree/cup/blob/0bef27b2733379987bd0af64722a2031ab7ada27/docs/research/gemini-tts-unspoken-context.md) on the unmerged branch `research/gemini-tts-unspoken-context`.
- Speech recognition research: [`overlap-cut-aligner.md`](https://github.com/patricktree/cup/blob/b3672e77bfc92bce2451a13423eb3199543ffd27/docs/research/overlap-cut-aligner.md) on the unmerged branch `research/overlap-cut-aligner`.
- Long-form Gemini narration research: [`gemini-long-form-segment-boundaries.md`](https://github.com/patricktree/cup/blob/01cf19d87291687133ee3c1a64c2b65e15d88ddb/docs/research/gemini-long-form-segment-boundaries.md) on the unmerged branch `research/gemini-long-form-narration-seams`.
