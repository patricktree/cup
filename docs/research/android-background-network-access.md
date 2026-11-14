# Android background network access

Research date: 2026-11-14, for [CUP-71](https://linear.app/cup-audio/issue/CUP-71). Observed on the mobile E2E suite's emulator `cup-mobile-e2e-api36-ram4g` (Android 16, Google APIs system image `android-36` `arm64-v8a`, emulator 36.4.10.0), running the debug build of the Android shell from commit `fc4d38ae` without a test origin, so it talked to production `https://cup.audio`. The probes sent only `GET /`. External claims come from Android's [Android 15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-all#background-network-access), read on the research date. No physical device took part.

## Question

The Android app's player sometimes showed `Unable to resolve host "cup.audio": No address associated with hostname` while an audiobook played. Which request fails, and under which conditions?

## Answer

- **Leaving the foreground cuts Cup's network access.** About 5 to 7 seconds after Cup left the foreground (HOME pressed; a locked screen leaves the activity stopped the same way), every request to `cup.audio` failed until Cup was visible again. The first request after its return succeeded.
- **The error is the reported one.** `CapacitorHttp` rejects with `Unable to resolve host "cup.audio": No address associated with hostname`, code `UnknownHostException`, and logcat shows it as a plugin error. Cup's patched `fetch` rejects the same request with `TypeError: Failed to fetch`.
- **Playing audio does not prevent it.** With a looped tone playing in the WebView, Cup stayed at process state 15 (cached), the tone and JavaScript timers kept running for the whole 30 seconds, and the requests failed just the same. This matches the report: playback continued while a listening-position save failed, and the player showed the failure.
- **Android documents this.** Since Android 15, for all apps, a network request started "outside of a valid process lifecycle" receives an exception, "Typically, an `UnknownHostException` or other socket-related `IOException`" ([background network access](https://developer.android.com/about/versions/15/behavior-changes-all#background-network-access)). The page recommends lifecycle-aware requests, WorkManager, or a foreground service for work the user can see.
- **Loopback is exempt.** Requests to `http://localhost` over `adb reverse` kept succeeding in the background, so the [mobile E2E suite](../../qa/mobile-e2e/README.md), whose test Worker is always on `localhost`, cannot reproduce this.

## Implications

- Saving a failed position again when Cup returns to the foreground works: the network is back at once. Cup does that since CUP-71 ([positions](../architecture/conversion.md#delivery-positions-and-lifecycle)).
- Saves during background playback can only reach the server while Cup is not cached, which a `mediaPlayback` foreground service would ensure, as [Capacitor WebView playback](webview-audio-playback.md) already called for.
- Untested inference: the narration track streams from `cup.audio` through the WebView's network stack under the same app, so a long track probably stops in the background once its buffer runs out. A long remote track in the same setup would show it.

## Limits

One emulator image and one Android version; no physical device, so Doze, App Standby, OEM changes and a real locked screen were not observed. The probe played a generated `blob:` tone, not a narration track. Whether the cached apps freezer was enabled on the emulator was not checked; Cup was not frozen within 30 seconds.

## Reproduction

The [probe archive](./android-background-network-access.tar.xz) contains `steps.sh`, the commands of the run; `cdp-eval.mjs`, which evaluates JavaScript in Cup's WebView through its devtools socket; `fetch-probe.js`, which requests `cup.audio` every 3 seconds through the `CapacitorHttp` plugin and through `fetch`; and `audio-probe.js`, which also plays a looped tone after a tap and requests a `localhost` server. Each probe logs every outcome with the page's visibility in `window.__probe.log`, read once Cup is back in the foreground, because a frozen app's devtools socket can hang adb.

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
