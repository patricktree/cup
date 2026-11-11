---
status: accepted
---

# Time-stretch narration audio after synthesis with Sonic

Listeners found Cup's narration a little slow: every audiobook was narrated at the natural pace of Gemini 3.8 Flash-Lite TTS for the voice Charon, and nothing sped it up. The map [patricktree/cup#263](https://github.com/patricktree/cup/issues/263) decided how to narrate faster in [#264](https://github.com/patricktree/cup/issues/264), [#266](https://github.com/patricktree/cup/issues/266) and [#273](https://github.com/patricktree/cup/issues/273), the spec [#275](https://github.com/patricktree/cup/issues/275) described it, and [#276](https://github.com/patricktree/cup/issues/276) and [#277](https://github.com/patricktree/cup/issues/277) implemented it.

## Decision

- **Time-stretch after synthesis instead of directing the model's pace.** Each audio segment's provider PCM is time-stretched with [Sonic](https://github.com/waywardgeek/sonic) before MP3 encoding, keeping the voice's pitch. The Gemini request stays exactly as it was. Gemini 3.8 Flash-Lite TTS has no speaking-rate parameter, and a free-text pace direction in `speech_metadata.style` changed the pace by between ×1.09 and ×1.26 depending on language, segment and take, so it cannot deliver a small, uniform factor ([#264](https://github.com/patricktree/cup/issues/264)).
- **×1.05, tied to speech policy 6.** The factor was picked by ear from Sonic renders between ×1.05 and ×1.20 of English, German and a names-only byline ([#266](https://github.com/patricktree/cup/issues/266)). It follows from the speech policy rather than a speech-configuration field, so a stored manifest fully determines how its segments sound: policy 6 means ×1.05, every other policy means no stretch, and a conversion prepared under policy 5 keeps today's pace for every remaining and retried segment.
- **Sonic, with a minimal FFmpeg `atempo` build as the fallback.** Sonic, Apache-2.0, uses PICOLA, a pitch-synchronous overlap-add method built for speech, below 2×. Android's audio mixer calls it, and Media3/ExoPlayer's default playback-speed processor is a port of it. Its WebAssembly module measured 7.8 KB and stretched 160 s of speech in about 31 ms, against 320–410 ms for the LAME encode in the same step ([#273](https://github.com/patricktree/cup/issues/273)). If Sonic shows an artefact on real narration that `atempo` does not, or a Sonic bug we would rather not patch, a minimal FFmpeg `atempo` build (about 300 KB and 115 ms, LGPL-2.1+) replaces it.
- **The pace stays server-side.** The stretch is part of the stored narration audio, not a player playback rate, so every way of getting the audio, including a future download, has the same pace. A listener-chosen reading speed is a later layer on that baseline.

## Considered options

- **A pace direction in the Gemini request.** Rejected: the measured speed-up varied too much between languages, segments and takes for one uniform pace.
- **FFmpeg `atempo`, SoundTouch, Signalsmith Stretch or Rubber Band.** Rejected for Sonic's size, speed and speech focus; `atempo` stays the fallback.
- **A player playback rate.** Rejected: downloads and every other client would play at the provider's pace.

## Consequences

- Generated audio duration is the stretched duration, so a duration allowance covers about 5% more narration text. [ADR 0022](0022-reserve-70-milliseconds-of-audio-per-narration-text-character.md) lowers the reservation estimate to match.
- Sonic's upkeep is thin, one author and a last release in 2015. The [time-stretching library](../../libs/time-stretching/) pins a commit and builds it reproducibly from checksummed sources.
- Existing audiobooks keep their audio and pace; nothing is re-synthesized.

## Evidence

- Pace-control research: branch [`research/gemini-tts-pace-controls`](https://github.com/patricktree/cup/tree/research/gemini-tts-pace-controls).
- Characters-to-duration research: branch [`research/narration-characters-to-duration`](https://github.com/patricktree/cup/tree/research/narration-characters-to-duration).
- Listening prototype: branch [`prototype/narration-pace`](https://github.com/patricktree/cup/tree/prototype/narration-pace), with every clip and its milliseconds per character in `summary.json`.
- Time-stretch technology comparison: branch [`research/time-stretch-technology`](https://github.com/patricktree/cup/tree/research/time-stretch-technology), whose archive holds the build scripts for Sonic, the minimal FFmpeg `atempo` build, SoundTouch and Signalsmith Stretch.
