# Time-stretch technology for narration audio

> Historical research, incorporated 2026-11-11 by [ADR 0023](../adr/0023-time-stretch-narration-audio-after-synthesis-with-sonic.md), which keeps Sonic and names the minimal FFmpeg `atempo` build below as the fallback. The [time-stretching library](../../libs/time-stretching/) builds Sonic as recommended, pinned at commit `b93885dc` with Sonic's quality setting, and measured 30–32 ms for a 160 s segment in local `workerd` ([patricktree/cup#281](https://github.com/patricktree/cup/pull/281)). One difference from the prototype harness: Sonic's flush shortened the last pitch periods of a segment, so `stretchPcm` pads the input with silence before flushing and trims the output to the input length divided by the speed factor. External claims have not been reverified.

[Original investigation](https://github.com/patricktree/cup/blob/3f179be83ff776d2a2edb2fa7515228745f6ebb4/docs/research/time-stretch-technology.md).

Researched on 2026-11-11 for [#273](https://github.com/patricktree/cup/issues/273), part of the map [#263: narrate a little faster](https://github.com/patricktree/cup/issues/263). Narration audio gets a pitch-preserving ×1.05 time-stretch after synthesis and before MP3 encoding ([#266](https://github.com/patricktree/cup/issues/266)). The [pace-controls research](gemini-tts-pace-controls.md) picked Sonic; the operator questioned that pick because Sonic's GitHub repository has few stars, and asked why not FFmpeg. This note compares the options again from primary sources and from builds and measurements made for it. Repository observations are from commit `65043649`. No paid API calls were made.

## Answer

**Keep Sonic.** It is the time-stretch that Android itself uses for speech playback speed, it is built for speech, its Apache-2.0 licence asks the least of a closed service, and it is by far the smallest and cheapest option to run in a Worker: a 7.8 KB WebAssembly module that stretches a 160 s segment in about 31 ms, a tenth of the LAME encode that already runs in the same step. Its real weakness is not its star count but its upkeep: one author wrote almost all of it, the last tagged release is from 2015, and fuzzing reports are open. Pinning a commit and building it like LAME contains that risk.

**Runner-up: FFmpeg's `atempo` filter, in a minimal LGPL build** of `libavfilter` and `libavutil` with only `abuffer`, `atempo` and `abuffersink` enabled. It works and fits in a Worker (a 300 KB module, 115 ms for the same segment), and the operator heard no difference from Sonic at ×1.05 to ×1.10. It loses on build weight, module size and CPU, not on feasibility or sound. Switch to it if Sonic shows an audible artefact on real narration that `atempo` does not, if a Sonic defect turns up that upstream will not fix and Cup would rather not patch, or if Cup later needs other FFmpeg filters in the same step anyway.

**Not ffmpeg.wasm, not FFmpeg's `rubberband` filter, not Rubber Band.** ffmpeg.wasm is a 32 MB GPL build for browsers that relies on Web Workers; the `rubberband` filter and Rubber Band itself are GPL unless Cup buys a commercial licence. SoundTouch and Signalsmith Stretch both work in a Worker and are healthy projects, but neither is designed for speech, and both cost 11 to 15 times Sonic's CPU.

## Comparison

Measured in Node 24.18.0 (V8, as in workerd) on an Apple M4 Max, on 160 s of 24 kHz mono 16-bit speech, at ×1.05, median of five runs. Modules were built for this note with the Emscripten image that [`build-encoder.sh`](https://github.com/patricktree/cup/blob/65043649/libs/mp3-encoding/scripts/build-encoder.sh) pins, with LAME's flags (`-Oz -flto`, `STANDALONE_WASM`, `emmalloc`, stripped); see [Reproduction](#reproduction). These are not measurements in a deployed Worker: Cloudflare's servers will be slower or faster by some factor, but the ratios between the options should hold.

| Option                                                  | Adoption beyond GitHub stars                                                                                                                                     | Licence                              | Worker build                                                          | WebAssembly size | CPU for 160 s | Speech at ×1.03–×1.1                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- | ---------------: | ------------: | -------------------------------------------------------------------------------- |
| **Sonic** (PICOLA, a pitch-synchronous TD-PSOLA method) | Android's platform `AudioTrack` speed (AOSP `external/sonic`), Media3/ExoPlayer's default speed processor, espeak-ng, Debian `libsonic0` (~127k popcon installs) | Apache-2.0                           | One C file, no dependencies, no threads                               |           7.8 KB |         31 ms | Designed for speech; operator heard it as natural at ×1.05–×1.2                  |
| **FFmpeg `atempo`** (WSOLA)                             | FFmpeg itself is everywhere; `atempo` is one 1,190-line filter, by one author, with almost no changes since 2012 apart from API churn                            | LGPL-2.1+ (the default FFmpeg build) | Minimal `libavfilter` + `libavutil`; slow cross-build of a large tree |           300 KB |        115 ms | Operator heard it as natural, like Sonic, at ×1.05–×1.10                         |
| **ffmpeg.wasm**                                         | 18k stars, last release January 2025                                                                                                                             | GPL-2.0-or-later (core build)        | Browser-only design: Web Worker, runtime compilation                  |          32.2 MB |  not measured | As `atempo`                                                                      |
| **FFmpeg `rubberband`**                                 | —                                                                                                                                                                | Makes the whole FFmpeg build GPL     | Needs librubberband                                                   |                — |             — | As Rubber Band                                                                   |
| **Rubber Band** (phase vocoder, R2/R3 engines)          | Debian `librubberband2` (~152k installs); commercial licences sold                                                                                               | GPL-2.0+ or paid commercial licence  | C++, optional FFT library                                             |        not built |  not measured | R3 "especially" good for vocals, at much higher CPU                              |
| **SoundTouch** (WSOLA)                                  | Firefox's `playbackRate`, Debian `libsoundtouch1` (~137k installs); active releases                                                                              | LGPL-2.1                             | C++, builds without exceptions                                        |          23.4 KB |        349 ms | Tuned for music by default; `-speech` settings exist                             |
| **Signalsmith Stretch** (frequency domain)              | Active; 580 stars                                                                                                                                                | MIT                                  | Header-only C++ plus its `linear` library                             |          41.6 KB |        464 ms | "sounds best for more modest changes (between 0.75x and 1.5x)"; no speech claims |

For scale: the LAME module Cup already runs takes 320–410 ms to encode the same 160 s at 128 kbps in the same setup, and the Workflow step's CPU limit is 300,000 ms. Every option except ffmpeg.wasm is far inside the limits, so CPU decides nothing here except as a tiebreaker.

## Sonic

### Adoption: why the star count misleads

Sonic's repository has 702 stars and 184 forks ([GitHub API](https://api.github.com/repos/waywardgeek/sonic), read 2026-11-11). Stars count people who visited GitHub and clicked; they do not count products that copied the code, and Sonic is mostly consumed that way:

- **Android's audio framework.** AOSP vendors Sonic as [`platform/external/sonic`](https://android.googlesource.com/platform/external/sonic/), upgraded with Google's external updater as recently as February 2025. The mixer's `TimestretchBufferProvider` in [`media/libaudioprocessing/BufferProviders.cpp`](https://android.googlesource.com/platform/frameworks/av/+/refs/heads/main/media/libaudioprocessing/BufferProviders.cpp) includes `<sonic.h>` and calls `sonicCreateStream`, `sonicSetSpeed` and `sonicWriteShortToStream`/`sonicReadShortFromStream`; this is the path behind `AudioTrack.setPlaybackParams`. Every Android device ships it.
- **Media3 and ExoPlayer.** Media3's [`Sonic.java`](https://github.com/androidx/media/blob/main/libraries/common/src/main/java/androidx/media3/common/audio/Sonic.java) is a port whose doc comment reads "Based on `https://github.com/waywardgeek/sonic`", copyright Bill Cox, and is still being developed (float PCM support in September 2025). [`SonicAudioProcessor`](https://github.com/androidx/media/blob/main/libraries/common/src/main/java/androidx/media3/common/audio/SonicAudioProcessor.java) "uses the Sonic library to modify audio speed/pitch/sample rate", and [`DefaultAudioSink`](https://github.com/androidx/media/blob/main/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/audio/DefaultAudioSink.java) puts it at the end of its default processor chain and uses it for playback speed unless an app opts into the platform path (`setEnableAudioOutputPlaybackParameters`, default `false`). So podcast and audiobook apps built on ExoPlayer speed up speech with Sonic.
- **Speech synthesis on Linux.** espeak-ng optionally links libsonic for high speech rates (its `CMakeLists.txt` reports `libsonic: ${USE_LIBSONIC}`), and Debian packages Sonic as `libsonic0`, maintained by the Debian Accessibility Team, with about 127,000 reporting installs ([popcon](https://popcon.debian.org/), read 2026-11-11), in the same range as `libsoundtouch1` (137,000) and `librubberband2` (152,000).

That is stronger evidence for "Sonic speeds up speech well" than any star count: Google uses it as the default speech-speed path on two layers of its own stack.

### Upkeep: the real risk

- **One author.** `waywardgeek` has 215 of roughly 230 commits ([contributors](https://api.github.com/repos/waywardgeek/sonic/contributors)). Fifteen commits landed in the last year, the latest on 2026-03-14 (`b93885dc`, the commit the prototype built), including unit tests and a fuzzing target in November 2025.
- **No recent release.** The only tag is `release-0.2.0` from 2015-02-27; [#61](https://github.com/waywardgeek/sonic/issues/61) asks for a new one. Cup should pin a commit, not a release.
- **Open robustness reports.** Signed-overflow undefined behaviour in `interpolate()` ([#66](https://github.com/waywardgeek/sonic/issues/66)), a potential integer overflow in `insertPitchPeriod` ([#50](https://github.com/waywardgeek/sonic/issues/50)), and AFL findings ([#43](https://github.com/waywardgeek/sonic/issues/43)). Most concern pitch or rate changes, or extreme inputs, which Cup does not use. Cup's input is the model's own PCM, and the code runs inside a WebAssembly sandbox with its own linear memory, so a defect can at worst corrupt one segment or trap, which fails the Workflow step and retries it. A unit test that checks output length (input length divided by the factor, within a pitch period) catches gross failures.

Sonic is small enough to own if needed: `sonic.c` is 1,247 lines of ANSI C with no dependencies. Android and Media3 both patch their copies independently, which is also an option for Cup.

### Fit for Cup

- **Licence:** Apache-2.0. Shipping it in a closed service needs only the licence text and attribution in a notice, like `libs/mp3-encoding/THIRD_PARTY_NOTICES.md`; there is no relinking or source obligation.
- **Build:** `emcc sonic.c` plus a 20-line bridge, with LAME's flags, gives a 7,792-byte module whose only import is `env.emscripten_notify_memory_growth`, the import the LAME module already satisfies. No threads, no SIMD needed.
- **Output length:** 3,657,075 samples for an expected 3,657,143 (×1.05002): Sonic drops 68 samples (3 ms) at the end of 160 s. Duration accounting is unaffected because `analyzeMp3` measures the encoded result.
- **Determinism:** five runs gave the same output bytes. Sonic's stretch path is integer arithmetic on 16-bit samples with a deterministic pitch search, and the module is reproducible like LAME's.
- **Quality setting:** the prototype ran the CLI with `-q`, which calls `sonicSetQuality(stream, 1)` ("Disable speed-up heuristics. May increase quality.", `main.c`). The production bridge should do the same, so the factor the operator approved is rendered the same way.

## FFmpeg

### Can a minimal `atempo` build be made?

Yes. `atempo` is plain C in [`libavfilter/af_atempo.c`](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/af_atempo.c), "an implementation of WSOLA algorithm", which needs only `libavutil` (including its FFT, `av_tx`). FFmpeg 8.0.1 configures for Emscripten with `--disable-everything --disable-avformat --disable-avcodec --disable-swscale --disable-swresample --enable-avfilter --enable-filter=atempo,abuffer,abuffersink --disable-pthreads --enable-small`, and a bridge that feeds `abuffer → atempo → abuffersink` links into a 307,340-byte module (300 KB), against Sonic's 7.8 KB. Unlike Sonic, it imports eight WASI functions besides the memory-growth hook (`fd_read`, `fd_write`, `fd_seek`, `fd_close`, `fd_fdstat_get`, `clock_time_get`, `environ_get`, `environ_sizes_get`), pulled in by `libavutil` logging and libc, which the Worker bridge has to stub as `mp3-encoding.ts` does for LAME. Its output was 3,657,313 samples for an expected 3,657,143 (7 ms long), identical across runs, and the same length as the native FFmpeg 8.0 CLI output, though not bit-identical to it, because `atempo` uses floating-point FFTs.

The configure line keeps the build LGPL: it does not pass `--enable-gpl` or `--enable-nonfree` ([FFmpeg legal](https://ffmpeg.org/legal.html)). FFmpeg's checklist asks for dynamic linking; a separately shipped, replaceable WebAssembly module with its source and build script is the same arrangement Cup already uses for LGPL LAME, so it adds a notice and a source pointer but no new kind of obligation. The cost is in the build: the FFmpeg tarball is 11 MB, `libavfilter` and `libavutil` hold about 320,000 lines of C, and `configure` probes the toolchain for many minutes under emulated `linux/amd64` Docker on Apple Silicon (about 13 minutes for the whole build in this run), against seconds for Sonic.

### CPU and quality

The minimal `atempo` module took 115 ms for the 160 s segment (1,390× real time), 3.7 times Sonic and about a third of the LAME encode. Natively, the FFmpeg 8.0 CLI does the same in about 120 ms of user time. Either way it is far inside the step's limit.

On sound, the operator's listening is the most relevant evidence: in the [narration-pace prototype](https://github.com/patricktree/cup/tree/prototype/narration-pace/libs/audiobook-production/prototype-narration-pace), `atempo` and Sonic at ×1.05 to ×1.10 sounded equally natural on Charon. Sonic's author claims that "Sonic is better for speech, while WSOLA is better for music" ([docs](https://github.com/waywardgeek/sonic/blob/master/doc/index.md)), but his evidence is a 2× example, far from ×1.05. No published listening test compares Sonic, `atempo` or SoundTouch at small factors; the closest, Roberts and Paliwal's [TSM dataset with subjective labels](https://arxiv.org/abs/2006.00848), does not include Sonic and reports only that "All methods show improvement in quality as β approaches 1". At ×1.05 the choice between PICOLA and WSOLA is unlikely to be audible, which matches what the operator heard.

### Why not FFmpeg, then?

FFmpeg's reputation comes from its demuxers, codecs and command-line tool, and none of that is in play here. What Cup would use is one 1,190-line filter, written by one author in 2012 and essentially unchanged since apart from internal API moves ([history](https://github.com/FFmpeg/FFmpeg/commits/master/libavfilter/af_atempo.c)). In other words, it is a single-author component just like Sonic, wrapped in a much larger build. Against Sonic it brings:

- a module 39 times larger and a cross-build of a large, fast-moving tree that has to be re-pinned on every FFmpeg upgrade;
- an LGPL notice and source obligation instead of Apache-2.0 attribution;
- 3.7 times Sonic's CPU (still small);
- a time-domain method that is general-purpose rather than speech-specific, with no audible advantage at ×1.05.

Its advantages are a larger maintainer pool for the surrounding framework, a more conventional "nobody gets fired for choosing FFmpeg" story, and a route to other audio filters later. Those do not outweigh the cost for one fixed ×1.05 stretch, but they make it a sound fallback.

### ffmpeg.wasm

[ffmpeg.wasm](https://ffmpegwasm.netlify.app/docs/overview) is FFmpeg 5.1 compiled with Emscripten 3.1.40 for browsers. `@ffmpeg/core` 0.12.10's `ffmpeg-core.wasm` is 32.2 MB, the npm package declares GPL-2.0-or-later (the core is built with GPL components enabled), and the `@ffmpeg/ffmpeg` wrapper runs the core inside a Web Worker. A Cloudflare Worker has no threads and no Web Worker API, and `WebAssembly.instantiate()` "only supports pre-compiled modules" ([Workers WebAssembly](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)), so the package does not run as shipped. Even rebuilt, 32 MB is half of the 64 MiB Worker size limit, slows startup (the global scope must run within 1 s) and takes a large share of the 128 MB isolate memory ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). The minimal build above is the only sensible way to use FFmpeg in a Worker.

### The `rubberband` filter

FFmpeg's `rubberband` filter needs `--enable-librubberband`, and `configure` lists librubberband in `EXTERNAL_LIBRARY_GPL_LIST`, so enabling it requires `--enable-gpl` and makes the whole build GPL. See Rubber Band below.

## Other options

- **Rubber Band.** GPL-2.0-or-later, or a commercial licence from Breakfast Quay: "you may not" use it in a closed application without one ([README](https://github.com/breakfastquay/rubberband)). Its R3 engine gives "higher-quality results than R2 for most material, especially complex mixes, vocals" but "uses much more CPU". It is a strong option for music production; for a ×1.05 speech stretch, the licence cost buys nothing the operator could hear. Last release v4.0.0, October 2024; one commit in the last year.
- **SoundTouch.** LGPL-2.1, maintained on [Codeberg](https://codeberg.org/soundtouch/soundtouch) with releases 2.4.0 (April 2025) and 2.4.1 (March 2026). It is Firefox's time-stretcher for `playbackRate` (`dom/media/AudioStream.h` holds an `RLBoxSoundTouch` as `mTimeStretcher`), while Chromium uses its own WSOLA (`media/filters/audio_renderer_algorithm.h`). Its defaults are tuned for "pop/rock music"; the bridge here used the `soundstretch -speech` settings (sequence 40 ms, seek window 15 ms, overlap 8 ms). Built with `-DSOUNDTOUCH_INTEGER_SAMPLES=1 -DST_NO_EXCEPTION_HANDLING=1`: 23.4 KB, 349 ms, exact output length, deterministic. A credible second runner-up with the same LGPL posture as `atempo` and a smaller build, but 11 times Sonic's CPU and no speech design.
- **Signalsmith Stretch.** MIT, active (84 commits in the last year, release 1.4.0). Frequency-domain, header-only C++ plus Signalsmith's `linear` library 0.6.4. Built with a fixed random seed (it randomises phases only above ×2): 41.6 KB, 464 ms, exact output length, deterministic. Its own README positions it for music and pitch work, and it says its formant correction is less sharp than monophonic algorithms such as PSOLA. Use it only if Cup ever needs pitch or formant control.
- **Chromium's WSOLA** (`AudioRendererAlgorithm`, which mpv's `af_scaletempo2` ports, "Algorithm overview (from chromium)") carries browser speech playback, but lives inside larger media frameworks with no standalone library to pin; it offers nothing over `atempo` here.
- **Neural or model-side pace.** A neural time-scale model is far out of proportion, and pace directions in `speech_metadata.style` were rejected in [#266](https://github.com/patricktree/cup/issues/266) because they cannot hit ×1.05.

## Running the stretch outside the Worker

A [Cloudflare Container](https://developers.cloudflare.com/containers/) could run native FFmpeg or Rubber Band. The Worker would reach it through a Durable Object binding, send each segment's PCM (about 7.7 MB for 160 s) over HTTP and wait for the result inside the Workflow step. That adds an image to build, pin and patch, cold starts, a second deployable with its own failure modes and retries, and per-second memory billing while instances are provisioned ([pricing](https://developers.cloudflare.com/containers/pricing/): smallest instance 1/16 vCPU and 256 MiB). It would make sense only for an algorithm that cannot run in a Worker, such as GPL code that must stay out of Cup's bundle or a CPU-heavy engine. Every serious candidate here runs in-Worker in under half a second, so a container buys nothing.

## Build and determinism

Every module built here is single-threaded, needs no SIMD, and produced identical output bytes across five runs. Sonic, SoundTouch and Signalsmith Stretch import only `env.emscripten_notify_memory_growth`; the FFmpeg module also imports eight WASI functions. Each can follow `build-encoder.sh`: download on the host, verify a SHA-256, build in the pinned Emscripten image with `--network none`, and refuse to copy the module unless its SHA-256 matches a pinned value. For Sonic, pin a commit archive (`https://github.com/waywardgeek/sonic/archive/<commit>.tar.gz`) rather than a release; the prototype used `b93885dc`. Floating-point WebAssembly arithmetic is deterministic apart from NaN bit patterns, so even the float-based options give stable output for a given module.

Integration notes for the spec, whichever library is used:

- Put the bridge's interface in its own package, as `@cup/mp3-encoding` does, with the same `workerd`/`node` import split for the `.wasm` file.
- Stretch the whole segment at once and flush (`sonicFlushStream`), so the tail is not lost; the measured peak WebAssembly memory for a 160 s segment was 37 MiB for Sonic, inside the 128 MB isolate limit together with LAME.
- Test that output length equals input length divided by the factor within a small tolerance, and pin the module's SHA-256 and import list like the LAME security test.

## Reproduction

The [archive](time-stretch-technology.tar.xz) holds the four bridges, the in-container build script, the Node benchmarks, the four built modules, the FFmpeg configure summary, and the measured results (`results.jsonl`). Inputs: FFmpeg 8.0.1 (`ffmpeg-8.0.1.tar.xz`, SHA-256 `05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41`), Sonic `b93885dc` (GitHub archive, `b76d832649306b53e716c271014c0b8f89f6bcefc43e5068a2eca3cf1946324c`), SoundTouch 2.4.1 (Codeberg archive, `35d404e6e8c2ebd12fb4000da6fadd75c99e37eed2126a04721828c11c0377ec`), Signalsmith Stretch 1.4.0 (`077235709ecf2a358545e3ca7bdf32859f70f5c9afb4493e078bd753c9aff284`) with Signalsmith Linear 0.6.4. The speech input was 160 s of macOS `say` output resampled to 24 kHz mono with FFmpeg; it is not Charon, so the numbers measure cost, not sound.

```sh
# Unpack the sources into src/{ffmpeg-8.0.1,sonic,soundtouch,stretch,linear}, then:
docker run --rm --platform linux/amd64 --network none --read-only --tmpfs /tmp \
  --volume /emsdk/upstream/emscripten/cache \
  --volume "$PWD/src:/src:ro" --volume "$PWD/bridges:/bridges:ro" --volume "$PWD/work:/work" \
  emscripten/emsdk@sha256:8714ed3a9fb585e662c931259a996bac36a57a8dd34b81e8277436fd77364475 \
  sh /bridges/build.sh
node bench.mjs work/out/sonic.wasm speech-160s.pcm sonic-1.05.pcm 1.05 5
```
