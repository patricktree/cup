---
status: superseded
---

# Use a canonical synchronized audiobook independent of exports

Superseded by [ADR 0005](0005-prepare-narration-before-player-controlled-synthesis.md). The original rationale follows; current playback uses prepared text and independent audio segments, and exports have been removed.

A conversion produces a canonical audiobook comprising a simple narration document, one MP3 playback track, and synchronization cues that map existing narration chunks to intervals in that track. The controlled reader consumes this model directly; a standalone MP3 and an EPUB 3 publication with Media Overlays are derived representations. This separates the guaranteed reading experience from uneven third-party reader behavior and allows export failures to remain independent of audiobook readiness.

## Considered Options

- Keep producing only an audio file. This cannot provide synchronized text or text-based seeking.
- Make EPUB the canonical representation. This would constrain the controlled reader to the interaction model and inconsistent behavior of third-party EPUB readers.
- Infer fine-grained timing through speech-to-text. This could make the displayed text disagree with the narration text and is unnecessary for the accepted coarse synchronization.

## Consequences

- One current paragraph-oriented narration chunk is one coarse synchronization unit. Headings attached to following paragraphs remain part of the same unit, while oversized paragraphs may span multiple units.
- The final encoded MP3 is the timing authority. Cue validation must seek within 250 milliseconds of a unit's audio start without clipping its first spoken word.
- The narration document preserves only a small safe subset of document structure and speaks the source title as its first unit.
- A conversion is ready when its canonical audiobook is available. EPUB generation runs on demand with an independent lifecycle.
- Implementation validates a minimal EPUB export before building the controlled reader so mobile interoperability assumptions fail early.
