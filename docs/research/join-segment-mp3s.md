# Joining segment MP3s into one narration track

> Historical research, incorporated 2026-10-27 by [ADR 0011](../adr/0011-serve-one-narration-track-and-play-it-with-one-audio-element.md). Cup adopted the per-request join of unchanged stored segments, the fixed segment format that `analyzeMp3` now enforces (including bitrate and padding), and start offsets as running sums of settled durations; see [conversion delivery](../architecture/conversion.md) and [R2 storage](../architecture/r2-storage.md). Repository paths below describe `0fb4e71d`.

[Original investigation](https://github.com/patricktree/cup/blob/1fd646711bff923997aed6cbad0eedd670127646/docs/research/join-segment-mp3s.md).

Research date: 2026-10-27, for [issue #59](https://github.com/patricktree/cup/issues/59) on the [narration track map](https://github.com/patricktree/cup/issues/56). Repository observations are from commit `0fb4e71d`. Measurements used Node 24.18.0, FFmpeg 8.0, Google Chrome 155.0.8059.85, and AVFoundation on macOS 27.0.1 (Apple Silicon). Browser source links are pinned to Chromium `2099425a` (its FFmpeg fork at `42a2a7a2`), Firefox `5a78f452`, and WebKit `d1cdb930`, all read on the research date.

## Question

Can Cup's independently encoded segment MP3s be concatenated byte for byte into one narration track whose duration and seeking are accurate in Safari, Chrome, and Firefox? Specifically: do stored segments carry Xing/Info or LAME tag frames, does the bit reservoir make a segment depend on bytes outside it, what gap does encoder delay and padding add at each join, do the per-segment [`analyzeMp3`](https://github.com/patricktree/cup/blob/0fb4e71d/libs/audiobook-production/src/audio-format.ts) durations still give exact start offsets, and do browsers derive duration and seek positions accurately enough (the 250 ms tolerance of [ADR 0001](../adr/0001-use-a-canonical-synchronized-audiobook.md)) without an Info header for the whole track?

## Answer

Yes. A per-request join that streams the stored segment objects back to back, in sequence order, with nothing stripped and nothing added, is a valid MP3 whose duration and seek positions are exact in Chrome and AVFoundation (measured) and in Firefox (from source). Production already strips everything that needs stripping (ID3 tags), and the encoder writes no Xing/Info/LAME tag frame. Do not add an Info header for the whole track: it is unnecessary for duration, would trim only the first segment's priming, and would shift the timeline the server's start offsets assume. The join adds about 50–60 ms of silence per boundary (encoder priming plus end padding) and no click. Each segment's reported start offset (the running sum of `analyzeMp3` durations) lands on a frame boundary; its first audible sample follows a constant 46 ms later in FFmpeg-based decoding (24 ms in AVFoundation), far inside 250 ms.

The join must hold one invariant: every segment in a track has the same MPEG version, sample rate, channel mode, and bitrate. `analyzeMp3` checks sample rate and channel mode but not bitrate.

## What the encoder writes

[`lame-bridge.c`](https://github.com/patricktree/cup/blob/0fb4e71d/libs/mp3-encoding/native/lame-bridge.c) configures LAME 4.0 for mono CBR and calls `lame_set_bWriteVbrTag(encoder->lame, 0)` and `lame_set_write_id3tag_automatic(encoder->lame, 0)`. So no Xing/Info/LAME tag frame and no ID3 tag is written, and [`encodePcmAsMp3`](https://github.com/patricktree/cup/blob/0fb4e71d/libs/mp3-encoding/src/mp3-encoding.ts) returns only audio frames. [`produceAudioSegment`](https://github.com/patricktree/cup/blob/0fb4e71d/libs/audiobook-production/src/produce-audio-segment.ts) stores `encodedAudio.slice(audioStart, audioEnd)` from `analyzeMp3`, which equals the whole encoder output here.

Measured on four synthetic segments (below), every frame is MPEG-2 Layer III, 24 kHz, mono, 128 kbps, without CRC and without the padding bit, and exactly 384 bytes long. An MPEG-2 Layer III frame holds 576 samples and is `72 × bitrate / sample rate + padding` bytes (ISO/IEC 13818-3; the same formula is in `analyzeMp3`), so at 24 kHz it is `3 × kbps` bytes: always an integer, for every allowed bitrate, so LAME never needs the padding bit. Each frame lasts exactly 24 ms, so the stream is 16,000 bytes per second, and byte offset and time are exactly proportional.

No frame has `Xing`, `Info` (byte 13 after the 4-byte header and 9-byte side information) or `VBRI` (byte 36). Nearly every frame contains the ASCII text `LAME4.0`: LAME writes its version string into unused ancillary bits. That filler is ordinary audio-frame content, not a tag. In a frame that encodes silence it can sit at byte 13, where a tag would start; FFmpeg and Firefox compare exactly against `Xing` and `Info` there ([mp3dec.c#188](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/42a2a7a2b2ceb0b1554af1e99a8cdaae189404bb/libavformat/mp3dec.c#188), [MP3FrameParser.cpp#L374](https://github.com/mozilla-firefox/firefox/blob/5a78f4525f81f7323c2c044965096723318af6e6/dom/media/mp3/MP3FrameParser.cpp#L374)), so it is not mistaken for one.

Mid-stream tag frames do not occur, so the question whether they mislead browsers is moot for Cup. For the record: FFmpeg parses tags only while opening the stream ([`mp3_read_header` calls `mp3_parse_vbr_tags`](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/42a2a7a2b2ceb0b1554af1e99a8cdaae189404bb/libavformat/mp3dec.c#502)), and Firefox parses a VBR header only on the first parsed frame ([MP3Demuxer.cpp#L663](https://github.com/mozilla-firefox/firefox/blob/5a78f4525f81f7323c2c044965096723318af6e6/dom/media/mp3/MP3Demuxer.cpp#L663)), so a later Info frame would be treated as one more audio frame.

## Bit reservoir

A Layer III frame's side information starts with `main_data_begin`, the number of bytes before the frame's own main-data slot where its main data starts; those bytes lie in earlier frames' slots (ISO/IEC 11172-3 §2.4.3.4.1, ISO/IEC 13818-3). A frame never refers forward. The reproduction script parses `main_data_begin` for every frame and checks it against the main-data bytes already present in the same segment.

| Segment | Frames | Frames using the reservoir | Largest `main_data_begin` | First frame's `main_data_begin` | Frames borrowing from before the segment |
| ------- | -----: | -------------------------: | ------------------------: | ------------------------------: | ---------------------------------------: |
| a       |     44 |                         20 |                       255 |                               0 |                                        0 |
| b       |    100 |                         39 |                       255 |                               0 |                                        0 |
| c       |     32 |                          8 |                       255 |                               0 |                                        0 |
| d       |     71 |                         27 |                       255 |                               0 |                                        0 |

LAME starts every encode with an empty reservoir and uses it heavily within a segment, but no frame reaches outside its segment. So frames concatenate correctly: decoding the joined file and decoding each segment alone and concatenating the PCM differ by at most 7 of 32,768 levels. The small difference comes from the decoder's overlap-add across the boundary into near-silent samples.

Seeking into the middle of any MP3 that uses the reservoir means the first frame after the seek may lack its borrowed bytes; decoders mute or drop it. That is generic MP3 behavior, not something the join introduces, and it is part of the seek error measured below.

## Encoder delay, padding, and start offsets

LAME delays the signal by `ENCDELAY` = 576 samples and the decoder adds 528 or 529 more ([encoder.h](https://sourceforge.net/p/lame/svn/7113/tree/trunk/lame/libmp3lame/encoder.h), lines 57 and 89; FFmpeg and Firefox add 528 + 1). The flush pads the end to a whole frame plus the decoder's lookahead. The [LAME tag specification](http://gabriel.mp3-tech.org/mp3infotag.html) stores these delay and padding values so a player can trim them; Cup's segments carry no tag, so every decoder plays them.

| Segment | Input PCM | `analyzeMp3` duration | Decoded − input | Silence before content | Silence after content |
| ------- | --------: | --------------------: | --------------: | ---------------------: | --------------------: |
| a       | 1005.7 ms |               1056 ms |    1207 samples |                45.9 ms |                4.3 ms |
| b       | 2345.0 ms |               2400 ms |    1319 samples |                46.0 ms |                8.9 ms |
| c       |  708.5 ms |                768 ms |    1429 samples |                46.0 ms |               13.5 ms |
| d       | 1650.0 ms |               1704 ms |    1296 samples |    46.0 ms (after 400) |                8.0 ms |

Segment d's input starts with 400 ms of intended silence; the 46 ms are measured after it. "Decoded − input" is `analyzeMp3`'s duration minus the PCM length, so a segment's stored duration is 50–60 ms longer than its speech.

In the joined track (247 frames, 94,848 bytes, 5,928 ms):

- **Gap at each join:** 50.3 ms (a|b) and 54.9 ms (b|c) of silence where the input had none, and 459.5 ms where segment d intended 400 ms. This is the previous segment's padding plus the next segment's 46 ms priming.
- **No click:** the largest step between adjacent samples within ±2 ms of a join is 19 levels, against a signal amplitude of 12,000. The previous segment ends in encoded silence and the next begins in priming silence, so the overlap-add has nothing to collide with.
- **Start offsets:** the running sum of `analyzeMp3` durations is 0, 1056, 3456, and 4224 ms. Each is a frame boundary, and each segment's first audible sample decodes 45.9–46.0 ms after it in FFmpeg (ffmpeg CLI, which Chrome's decoder matches). AVFoundation places content 22.04 ms (529 samples) earlier on its timeline, a constant offset consistent with Apple trimming the decoder delay. Either way the offset is constant and well inside 250 ms, so the server's reported start offsets need no correction. Subtracting a constant 46 ms would make highlighting start on the first word rather than on the priming, but is optional.
- **Track duration:** `analyzeMp3` on the joined bytes, the sum of segment durations, `Content-Length × 8 / 128,000`, and ffprobe (`format=duration`, 247 packets) all give exactly 5.928 s.

The pause added per join accumulates: an audiobook of 200 segments gains about 10–12 s. Segment boundaries are narration-chunk boundaries, where speech already pauses, so the extra 50–60 ms should rarely be audible; this was not checked by ear on real narration. Removing it would require trimming samples, which a frame join cannot do; a stored, re-encoded track could.

## Browsers without an Info header

| Engine                      | Duration rule                                             | Measured or derived duration   | Seek rule                                          | Measured seek error                                     |
| --------------------------- | --------------------------------------------------------- | ------------------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| Chrome 155 (FFmpeg demuxer) | `filesize × 8 / bit_rate`                                 | 5.928 s and 3,604.224 s, exact | byte = `t × filesize / duration`, then resync      | −19.8 to +9.0 ms                                        |
| Firefox (`dom/media/mp3`)   | `(length − first frame offset) × 8 / first-frame bitrate` | exact by arithmetic; not run   | frame index × mean frame length, then scan forward | not run                                                 |
| AVFoundation, macOS 27.0.1  | closed source                                             | 5.928 s and 3,604.224 s, exact | closed source                                      | constant −22.04 ms (decoder-delay trim), no phase error |

**Chrome.** `<audio src>` plays through FFmpeg's libavformat. Without a Xing, Info, or VBRI tag, `mp3_parse_vbr_tags` sets no duration, and FFmpeg estimates it from the bitrate ([`estimate_timings_from_bit_rate`, demux.c#1823](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/42a2a7a2b2ceb0b1554af1e99a8cdaae189404bb/libavformat/demux.c#1823)); [`FFmpegDemuxer`](https://chromium.googlesource.com/chromium/src/+/2099425aa2ebcd28df8db720694c301d28c181d3/media/filters/ffmpeg_demuxer.cc#1580) uses the larger of stream and format duration. Chrome sets `AVFMT_FLAG_FAST_SEEK` with the comment "Enable fast, but inaccurate seeks for MP3" ([ffmpeg_glue.cc#115](https://chromium.googlesource.com/chromium/src/+/2099425aa2ebcd28df8db720694c301d28c181d3/media/filters/ffmpeg_glue.cc#115)), and [`mp3_seek`](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/42a2a7a2b2ceb0b1554af1e99a8cdaae189404bb/libavformat/mp3dec.c#652) then scales the target time by `filesize / duration` to a byte position and resynchronizes on frame headers. For a stream with constant 384-byte frames that scaling is exact, so the error is bounded by one frame plus a possibly muted first frame. Measured with real Chrome (27 seeks into a 5.9 s track and a one-hour, 57.7 MB track, at three different frame phases), audio started between 19.8 ms later and 9.0 ms earlier than requested, identically near the start and 3,587 s into the hour. `currentTime` after `seeked` equals the requested time.

**Firefox.** Not installed on the research machine, so this is from source only. Without a complete VBR header, `Duration()` is the stream length minus the first frame's offset (and an ID3v1 tag), times 8, divided by the first frame's bitrate ([MP3Demuxer.cpp#L355-L401](https://github.com/mozilla-firefox/firefox/blob/5a78f4525f81f7323c2c044965096723318af6e6/dom/media/mp3/MP3Demuxer.cpp#L355-L401)), which is exact for Cup's tracks. [`FastSeek`](https://github.com/mozilla-firefox/firefox/blob/5a78f4525f81f7323c2c044965096723318af6e6/dom/media/mp3/MP3Demuxer.cpp#L174) jumps to the frame index times the average frame length (384 bytes here), and [`ScanUntil`](https://github.com/mozilla-firefox/firefox/blob/5a78f4525f81f7323c2c044965096723318af6e6/dom/media/mp3/MP3Demuxer.cpp#L210) walks frame by frame to the target, so seeking should be frame-exact.

**Safari.** WebKit plays `<audio>` through AVFoundation. [`MediaPlayerPrivateAVFoundationObjC.mm`](https://github.com/WebKit/WebKit/blob/d1cdb930fee370bcddb8407590b5f113ceaf1e89/Source/WebCore/platform/graphics/avfoundation/objc/MediaPlayerPrivateAVFoundationObjC.mm#L915-L1011) does not set `AVURLAssetPreferPreciseDurationAndTimingKey` for media elements and reports `AVPlayerItem.duration`; setting `currentTime` asks AVFoundation for a zero-tolerance seek ([HTMLMediaElement.cpp#L3998-L4002](https://github.com/WebKit/WebKit/blob/d1cdb930fee370bcddb8407590b5f113ceaf1e89/Source/WebCore/html/HTMLMediaElement.cpp#L3998-L4002)). Apple's [documentation of that key](https://developer.apple.com/documentation/avfoundation/avurlassetpreferprecisedurationandtimingkey) says formats other than QuickTime and MPEG-4 may need content examination for an exact duration, and that the default suits playback. Apple's MP3 parser is closed source. Measured through AVFoundation directly on local files, `AVURLAsset.duration` without and with the precise key and `AVPlayerItem.duration` all return exactly 5.928 s and 3,604.224 s. `AVAssetReader` decoding from 18 seek targets placed content at a constant −22.04 ms on every target, with no variation by frame phase or file position. That is AVFoundation, not Safari: the check did not drive `AVPlayer`, HTTP loading, or iOS.

## A single Info header for the whole track

Not needed, and better avoided:

- **Duration** is already exact in all three engines without it.
- **Gapless trimming** applies only at the ends of the stream: FFmpeg skips `start_pad + 528 + 1` samples ([mp3dec.c#267](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/42a2a7a2b2ceb0b1554af1e99a8cdaae189404bb/libavformat/mp3dec.c#267)) and Firefox reads the LAME delay plus 529 ([MP3FrameParser.cpp#L458](https://github.com/mozilla-firefox/firefox/blob/5a78f4525f81f7323c2c044965096723318af6e6/dom/media/mp3/MP3FrameParser.cpp#L458)). One tag cannot describe the priming at each internal join, so it would remove 46 ms only before segment 0 and the padding only after the last segment. It would also add a 24 ms tag frame at the start (Firefox counts it into the delay). Every start offset after segment 0 would move by a different amount per engine, so the server's offsets would no longer be engine-independent.
- **Seeking** gets no better: FFmpeg uses the TOC only with `usetoc` or for non-CBR files ([mp3dec.c#670](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/42a2a7a2b2ceb0b1554af1e99a8cdaae189404bb/libavformat/mp3dec.c#670)), and Firefox's TOC gives a starting point at 1 % granularity before it scans forward.
- **A wrong byte count backfires**: if the file exceeds the tag's byte count by more than 1/16, FFmpeg logs "invalid concatenated file detected" and falls back to the bitrate ([mp3dec.c#204](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/42a2a7a2b2ceb0b1554af1e99a8cdaae189404bb/libavformat/mp3dec.c#204)).

If a header were added anyway, it would have to be a 384-byte Info frame whose frame and byte counts cover the whole joined track, generated per request.

## What a per-request join must do

- **Strip:** nothing beyond what production already strips. Stored segments are bare frames.
- **Add:** nothing. No Info frame, no ID3 tag.
- **Order and completeness:** stream all segments in sequence order; the map already requires every segment to have audio before a track exists.
- **Uniform format:** assert identical frame headers (MPEG-2, 24 kHz, mono, one bitrate) across all segments of a track. Both Chrome's and Firefox's duration rule take the bitrate from the stream as a whole or its first frame, so a segment at another bitrate would skew duration and every seek after it. `analyzeMp3` does not check bitrate today. If the map's open "segment bitrate" item lowers the bitrate, all segments of an audiobook must still share one.
- **HTTP:** report `Content-Length` as the sum of the segment object sizes and answer `Range` requests by mapping the byte range onto the segment objects. Duration and seeking rely on the total length, and Apple's archived Safari guide states that servers hosting media for iOS "must support byte-range requests" ([Configuring Your Server](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html)). This research served ranges but did not test a server without them.
- **Offsets:** report each segment's start as the running sum of stored `analyzeMp3` durations (equivalently its byte offset divided by 16,000 bytes per second).

## Reproduction

The [research archive](./join-segment-mp3s.tar.xz) contains three scripts and their outputs: `reproduce.ts` encodes four synthetic segments with the real `encodePcmAsMp3` at 128 kbps and 24 kHz, stores them as `produceAudioSegment` does, joins them, and writes `report.json` (frame, header, reservoir, delay, gap, and duration measurements, decoded with FFmpeg). `chrome-check.ts` builds a one-hour track from 608 copies of the sample, serves both over HTTP with `Range` support, plays them in Google Chrome through `<audio>` routed into Web Audio, and records the duration and where each of 27 seeks lands (`chrome-report.json`). `avfoundation-check.swift` reads durations and decodes from 18 seek targets with AVFoundation (`avfoundation-report.json`). The segments are amplitude-modulated tones (4 Hz envelope, 220–550 Hz) that start and stop at full level, so onsets are measurable; lengths are deliberately not multiples of a frame. The one-hour file is regenerated rather than archived.

Unpack from the repository root after `pnpm install`, then run (needs FFmpeg, Google Chrome, and Xcode's Swift):

```sh
tar -xJf docs/research/join-segment-mp3s.tar.xz -C docs/research
node docs/research/join-segment-mp3s/reproduce.ts . docs/research/join-segment-mp3s/out
node docs/research/join-segment-mp3s/chrome-check.ts . docs/research/join-segment-mp3s/out
swift docs/research/join-segment-mp3s/avfoundation-check.swift docs/research/join-segment-mp3s/out
```

## Limits and follow-up experiments

- **Safari itself was not run**, neither on macOS nor iOS, and nor were AVPlayer's seeks or HTTP loading through WebKit. To confirm, serve `joined-long.mp3` over HTTPS with `Range` support, open the page logic of `chrome-check.ts` in Safari on a Mac and an iPhone (Web Audio's `createMediaElementSource` exists there), and compare `duration` and the seek errors with the Chrome results. Watch [WebKit bug 328633](https://bugs.webkit.org/show_bug.cgi?id=328633) (filed 2026-10-23), which reports a zero duration for muted MP3 on iOS 27.0.1 with or without an Info frame; it does not concern unmuted playback but may surface in tests.
- **Firefox was not run.** Its conclusions rest on reading `MP3Demuxer.cpp`. To confirm, install Playwright's Firefox (`pnpm exec playwright install firefox`) and run `chrome-check.ts` with `firefox.launch()`.
- **Synthetic audio, not speech.** The gap and click measurements use tones with abrupt edges, a worse case for a click than speech that fades into a pause; the extra 50–60 ms of pause was not judged by ear on real narration.
- **One encoder build.** The findings hold for the pinned LAME 4.0 WASM build and its bridge settings; a change to `bWriteVbrTag`, the bitrate, or the sample rate needs this check again.
- **The Chrome and Firefox source readings and the LAME constants** come from the pinned revisions above; the seek and trimming code paths can change between releases.
