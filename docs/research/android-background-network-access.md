# Android background network access and freezing

Research date: 2026-11-14, for [CUP-71](https://linear.app/cup-audio/issue/CUP-71). Observed on the mobile E2E suite's emulator `cup-mobile-e2e-api36-ram4g` (Android 16, Google APIs system image `android-36` `arm64-v8a`, emulator 36.4.10.0, WebView Chrome 133.0.6943.137), running the debug build of the Android shell from commit `fc4d38ae` without a test origin, so it talked to production `https://cup.audio`. The probes sent only `GET /` to Cup and streamed one public-domain LibriVox MP3 from archive.org. External claims come from Android's [Android 15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-all#background-network-access), read on the research date. No physical device took part.

## Question

The Android app's player sometimes showed `Unable to resolve host "cup.audio": No address associated with hostname` while an audiobook played. Which request fails, and under which conditions? And why does playback sometimes stop in the Android app only?

## Answer

- **Leaving the foreground cuts Cup's network access.** About 5 to 7 seconds after Cup left the foreground (HOME pressed; a locked screen leaves the activity stopped the same way), every request to `cup.audio` failed until Cup was visible again. The first request after its return succeeded.
- **The error is the reported one.** `CapacitorHttp` rejects with `Unable to resolve host "cup.audio": No address associated with hostname`, code `UnknownHostException`, and logcat shows it as a plugin error. Cup's patched `fetch` rejects the same request with `TypeError: Failed to fetch`.
- **Playing audio does not prevent it.** With a looped tone playing in the WebView, Cup stayed at process state 15 (cached), the tone and JavaScript timers kept running for the whole 30 seconds, and the requests failed just the same. This matches the report: playback continued while a listening-position save failed, and the player showed the failure.
- **Android documents this.** Since Android 15, for all apps, a network request started "outside of a valid process lifecycle" receives an exception, "Typically, an `UnknownHostException` or other socket-related `IOException`" ([background network access](https://developer.android.com/about/versions/15/behavior-changes-all#background-network-access)). The page recommends lifecycle-aware requests, WorkManager, or a foreground service for work the user can see.
- **About a minute later, Android freezes Cup, and playback stops.** Streaming a 19-minute MP3 with Cup in the background, the position and a JavaScript timer advanced for about 70 seconds, then both stopped together: the position stayed at 84 seconds with 412 seconds buffered, so the buffer had not run out. `dumpsys activity processes` reported `isFrozen=false` 60 seconds after Cup left the foreground and `isFrozen=true` at 90 seconds. Back in the foreground, playback continued from where it stopped. This is the [cached apps freezer](https://source.android.com/docs/core/perf/cached-apps-freezer) acting on a cached process; playing audio does not exempt it.
- **Loopback is exempt.** Requests to `http://localhost` over `adb reverse` kept succeeding in the background, so the [mobile E2E suite](../../qa/mobile-e2e/README.md), whose test Worker is always on `localhost`, cannot reproduce this.

## Implications

- Saving a failed position again when Cup returns to the foreground works: the network is back at once. Cup does that since CUP-71 ([positions](../architecture/conversion.md#delivery-positions-and-lifecycle)).
- Background playback on Android needs Cup out of the cached state: a `mediaPlayback` foreground service, as [Capacitor WebView playback](webview-audio-playback.md) already called for, keeps it from being frozen and keeps its network access, so playback and saves continue. Its notification can be the media notification the Android app lacks, since the WebView shows none.
- The freeze comes first. WebView buffered about 7 minutes ahead and then stopped downloading, so a long narration track would also stall once that buffer runs out without network access, but only if the process were not frozen already.

## Limits

One emulator image and one Android version; no physical device, so Doze, App Standby, OEM changes, a real locked screen and the freezer delay on a phone were not observed. The probes played a generated `blob:` tone and a LibriVox MP3, not a narration track. The freeze came after 60 to 90 seconds, not the documented 10; why was not investigated. The stream ran with the emulator's network throttled to 80 kbps after it started, to keep the buffer small.

## Reproduction

The [probe archive](./android-background-network-access.tar.xz) contains `steps.sh`, the commands of the run; `cdp-eval.mjs`, which evaluates JavaScript in Cup's WebView through its devtools socket; `fetch-probe.js`, which requests `cup.audio` every 3 seconds through the `CapacitorHttp` plugin and through `fetch`; `audio-probe.js`, which also plays a looped tone after a tap and requests a `localhost` server; and `stream-probe.js`, which plays the MP3 after a tap and logs its position, buffered end and states every 5 seconds. Each probe logs every outcome with the page's visibility in `window.__probe.log`, read once Cup is back in the foreground, because a frozen app's devtools socket can hang adb.

The run with the tone playing, abridged:

```text
 3s visible playing=true cup.audio ok 200
 5s hidden  visibilitychange
 9s hidden  playing=true cup.audio ok 200
12s hidden  playing=true localhost ok 200
12s hidden  playing=true cup.audio ERR Unable to resolve host "cup.audio": No address associated with hostname
    … the same every 3 s, with localhost ok …
33s hidden  playing=true cup.audio ERR Unable to resolve host "cup.audio": No address associated with hostname
34s visible visibilitychange
36s visible playing=true cup.audio ok 200
```

The stream run, abridged; `at` is the position and `buffered` the buffered end, in seconds:

```text
  8s visible at=6   buffered=412 paused=false net=1 event:suspend
 16s hidden  at=14  buffered=412 paused=false visibilitychange
 85s hidden  at=83  buffered=412 paused=false tick
    … no tick for 230 s …
315s hidden  at=84  buffered=412 paused=false tick
320s visible at=89  buffered=412 paused=false tick
```
