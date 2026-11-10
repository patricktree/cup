# Running Android emulators and iOS simulators from a script on macOS

> Historical research, incorporated 2026-11-10 by [ADR 0018](../adr/0018-test-the-mobile-apps-with-appium-through-webdriverio-on-host-owned-emulators-and-simulators.md), whose host-owned devices and the rejection of Docker rest on it. The [mobile E2E suite](../../qa/mobile-e2e/README.md) differs in three ways: iOS runs one uniquely named simulator per run in the default device set, because WebDriverAgent does not work with a custom `simctl --set` ([spike](https://github.com/patricktree/cup/issues/186)); the Android AVD gets 4 GB of RAM, because at 2 GB the guest swapped and adb stalled; and the iOS runtime must match Xcode's SDK. External claims have not been reverified.

[Original investigation](https://github.com/patricktree/cup/blob/7bd843c76170eab01082097d3fac6e27f6ae8b88/docs/research/mobile-emulators-simulators-macos.md).

Research date: 2026-11-06, for [issue #181](https://github.com/patricktree/cup/issues/181) of the [automated mobile QA map](https://github.com/patricktree/cup/issues/179). Repository observations are from `main` at `626776ac`. Web sources were read on the research date. Measurements ran on the developer's Mac on the same day; the [environment](#environment) section lists the versions.

## Question

What does it take to start, use and tear down an Android emulator and an iOS simulator from a test script on a Mac, so the mobile suite can run inside a `validate` group? The ticket asks about headless start, boot times, snapshot or pre-booted reuse, installing a debug build, concurrent runs from several checkouts (each run starts its own servers on OS-assigned ports and never attaches to a running one), reaching a server on the host, `adb reverse`, Apple Silicon specifics, and whether Docker can host the Android emulator on macOS.

## Answer

| Point                                     | Android emulator                                                                                      | iOS simulator                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Headless start                            | `emulator -avd <name> -no-window -no-audio -no-boot-anim`                                             | `xcrun simctl boot <udid>`; Simulator.app never opens                                                |
| Ready signal                              | `adb -s <serial> shell getprop sys.boot_completed` returns `1`                                        | `xcrun simctl bootstatus <udid> -b` returns when booted                                              |
| Cold boot, measured                       | 20.6 s for a new AVD, 13.9 s for later cold boots, 16 s each for three at once                        | 18.0 s for a new device, 3.0 s for its second boot, 20.4 s for two at once (one of them a new clone) |
| Fast reuse, measured                      | Quick Boot snapshot: 1.6 s each for two read-only instances at once                                   | Reboot an existing device (3 s); a booted device cannot be cloned                                    |
| Per-run isolation                         | A fresh AVD in a per-run `ANDROID_AVD_HOME` (2.9 GB), or `-read-only` instances of one prepared AVD   | A per-run device set (`simctl --set <dir>`) holding a created or cloned device                       |
| Port conflicts                            | Console and adb ports come from 5554–5682; let the emulator pick and report it with `-report-console` | None: the simulator has no ports of its own                                                          |
| Shared host state                         | One adb server on port 5037                                                                           | One `CoreSimulatorService` process, observed                                                         |
| Install a debug build                     | `./gradlew assembleDebug`, then `adb -s <serial> install -r app-debug.apk`                            | `xcodebuild … -sdk iphonesimulator build`, then `simctl install <udid> App.app`                      |
| Reach a host server on `127.0.0.1:<port>` | `http://10.0.2.2:<port>`, or `adb reverse` to the device's own `localhost`                            | `http://localhost:<port>`, the host's loopback, observed                                             |
| Plain HTTP to that server                 | Blocked by default for `targetSdk` 36; needs a Network Security Configuration entry in debug builds   | `localhost` is allowed by ATS by default; IP addresses such as `127.0.0.1` are not since iOS 17      |
| Docker on macOS                           | Not possible with acceleration: Docker Desktop exposes no `/dev/kvm`, observed                        | Not possible: the simulator needs macOS and Xcode                                                    |

The suite can manage both device kinds itself with the stock command-line tools, start them headless, and run beside other checkouts without fixed ports. The recommendation at the end describes how.

## Environment

- Apple M4 Max, 36 GB memory, macOS 27.2 (`26B123`).
- Xcode 26.2 (`17C52`), iOS 26.3 simulator runtime (`23D8133`), device type iPhone 17.
- Android Emulator 36.4.10.0, adb 1.0.41 (platform-tools 36.0.0), system image `android-36;google_apis_playstore;arm64-v8a`, device profile `pixel_8`, 2 GB guest memory (`hw.ramSize` of the existing AVD).
- Docker Desktop with server 29.9.2, LinuxKit kernel 7.0.14, `aarch64`.

The probe scripts lived in the session's scratch directory and created their AVDs and simulator device sets there, so the developer's own AVDs and Xcode's default device set were untouched; the one exception is the `-read-only` run of the existing `ContentPushPixel36` AVD, which does not write to it.

## Android emulator

### Headless start and readiness

The emulator's command-line reference lists `-no-window` ("Disables graphical window display… You can access the emulator through `adb` or the console"), `-no-boot-anim`, `-no-audio` and the Quick Boot flags ([Start the emulator from the command line][android-cmdline]). The same page now opens with a notice that "The `emulator` tool is deprecated" in favor of the Android CLI's `android emulator` command. The binary still ships with Emulator 36.4.10 and all flags used here worked; the suite should call the `emulator` binary directly and watch the deprecation.

GPU mode needs no flag on a Mac: the default `auto` worked headless in every run. The acceleration guide marks `swiftshader_indirect` and `guest` as deprecated in Emulator 36.4.9 ([Configure hardware acceleration][android-accel]), so the flag older CI recipes pass is on its way out.

`adb wait-for-device` only waits for `adbd`. The probes polled `getprop sys.boot_completed` every 500 ms until it returned `1`; until then `adb` reported `device offline` or `not found`.

### Boot times

| Run                                                       | Time to `sys.boot_completed` |
| --------------------------------------------------------- | ---------------------------- |
| First boot of a freshly created AVD (`-no-snapshot-load`) | 20.6 s                       |
| Saving the Quick Boot snapshot on exit (`adb emu kill`)   | 1.1 s                        |
| Later cold boot (`-no-snapshot`)                          | 13.9 s                       |
| Two `-read-only` instances loading the snapshot at once   | 1.56 s and 1.59 s            |
| Three `-read-only` cold boots of one AVD started at once  | 16.0 s, 16.1 s, 16.2 s       |

The emulator log of the snapshot run read `Successfully loaded snapshot 'default_boot' using 567 ms`. Quick Boot restores the whole device, including installed apps and their data: "all contents of the system, user data, and SD card images are overwritten with the contents they held when the snapshot was made" ([`-snapshot`][android-cmdline]). A snapshot taken right after boot therefore gives every run the same clean starting state.

### Several instances and checkouts

Two mechanisms keep runs apart:

- **A separate AVD per run.** `avdmanager create avd` with `ANDROID_AVD_HOME` set to a per-run directory created an AVD whose data directory grew to 2.9 GB after one boot; deleting the directory tears it down. The emulator documents that each AVD has a single writable `userdata-qemu.img` in its data directory ([AVD data directory][android-cmdline]).
- **`-read-only` instances of one prepared AVD.** The local `emulator -help` describes `-read-only` as "allow running multiple instances of emulators on the same AVD, but cannot save snapshot". Two instances loaded the same snapshot and three cold-booted the same AVD at once.

Each instance needs a console port and an adb port. The emulator picks the first free pair "starting from 5554, in increments of two" when `-port` is absent (`emulator -help-port`), and the reference gives the range as "5554 to 5682, allowing for 64 concurrent virtual devices" ([`-port`][android-cmdline]). Fixed ports would collide across checkouts, so the script should let the emulator choose and learn the result: `-report-console tcp:<port>` makes the emulator connect to a socket the script listens on and send "its console port number as text" before it starts emulating, and "any failure in the process… will result in the emulator aborting immediately" (`emulator -help-report-console`). Three emulators started at the same moment reported 5556, 5554 and 5558, and all three appeared in `adb devices` as `emulator-<port>`. That is the Android counterpart to Cup's OS-assigned ports.

All checkouts share one adb server: "All `adb` clients use port 5037 to communicate with the `adb` server" ([How adb works][adb]). The server scans "odd-numbered ports in the range 5555 to 5585", the first 16 emulators ([How adb works][adb]); `adb --help` names `ADB_LOCAL_TRANSPORT_MAX_PORT` to widen that scan. An emulator started with `-port 5680`, outside the scan range, still showed up as `emulator-5680` once the server was running. The shared server is acceptable under Cup's rule, as the Playwright Server container is, if the suite never kills it (`adb kill-server` would drop every other checkout's devices) and addresses every command to its own device with `-s <serial>`, which overrides `ANDROID_SERIAL` ([Issue adb commands][adb]).

### Installing and launching the debug build

The repository already documents `./gradlew assembleDebug` and the APK at `apps/mobile-app/android/app/build/outputs/apk/debug/app-debug.apk` ([mobile app README](../../apps/mobile-app/README.md#android-locally)). `adb -s <serial> install -r <apk>` reinstalls an app while keeping its data, and `-g` grants every permission in the manifest ([package manager commands][adb]). `adb shell am start -W -n audio.cup.app/.MainActivity` waits for the launch to complete ([activity manager commands][adb]). Installing before taking a snapshot would let later runs skip the install, but then the snapshot has to be rebuilt whenever the APK changes, so installing per run is simpler.

### Reaching a server on the host

Each emulator sits behind its own virtual router. `10.0.2.2` is the "special alias to your host loopback interface (127.0.0.1 on your development machine)", and "if you have two instances running concurrently on your machine, each will have its own router, and behind that, each will have an IP address of `10.0.2.15`" ([Emulator networking address space][android-net]). A test Worker bound to `127.0.0.1` on an OS-assigned port is therefore reachable from every concurrent emulator at `http://10.0.2.2:<port>`, with no per-emulator setup.

`adb reverse` is the alternative: it forwards a port on the device's own loopback to a host port. `adb --help` documents `reverse [--no-rebind] REMOTE LOCAL` and that the remote side "may be `tcp:0` to pick any open port"; `adb -s emulator-5680 reverse tcp:0 tcp:8787` printed `36005`, and `reverse --list` showed `host-15 tcp:36005 tcp:8787`. Because each emulator has its own loopback, every run could also reverse the same fixed device port, such as `localhost:8787`, to its own host port. That lets the app use one origin, `http://localhost:8787`, on every emulator without knowing the host port, at the cost of one more step that must succeed after each boot.

Plain HTTP needs an opt-in. Cup targets API 36 (`android/variables.gradle`), and "Starting with Android 9 (API level 28), cleartext support is disabled by default"; an app opts in per domain with `<domain-config cleartextTrafficPermitted="true">` in a Network Security Configuration ([Network security configuration][android-nsc]). The implicit localhost exception that allows cleartext arrives only "From Android 17 (API level 37)" ([Localhost configuration][android-nsc]), so an API 36 build needs an explicit entry for `10.0.2.2` or `localhost` either way. `debug-overrides` covers only trust anchors ([`<debug-overrides>`][android-nsc]), so the entry belongs in a configuration that only debug builds include. Capacitor's `server.cleartext` is meant "for use with live-reload servers" and is "not intended for use in production" ([Capacitor configuration][capacitor-config]).

The native requests Cup makes go through `CapacitorHttp` to the hardcoded `https://cup.audio` ([mobile app README](../../apps/mobile-app/README.md#backend-access-and-grant-sessions)). Pointing a test build at a local Worker needs an origin override, which is outside this ticket.

## iOS simulator

### Headless simulator start and readiness

`xcrun simctl boot` starts a device without opening Simulator.app, and `simctl bootstatus <device> -b` "Monitors the specified device and prints boot status information until the device finishes booting", booting it first with `-b` (`xcrun simctl help bootstatus`). `simctl io <device> screenshot` and `recordVideo` work without a window (`xcrun simctl help io`).

### Simulator boot times

| Run                                            | Time   |
| ---------------------------------------------- | ------ |
| `simctl create` (iPhone 17, iOS 26.3)          | 0.2 s  |
| First boot of the new device                   | 18.0 s |
| Second boot of the same device                 | 3.0 s  |
| `simctl clone` of the shut-down device         | 1.7 s  |
| Booting the original and the new clone at once | 20.4 s |

The second boot is the fast path: a device created once and rebooted for each run starts in about 3 s, because first-boot setup does not repeat. A clone's first boot took about as long as a new device's, so cloning saves little boot time. `simctl clone` of a booted device failed with `Unable to clone device in current state: Booted`; a template device must be shut down first.

### Simulators for several checkouts

`simctl` accepts `--set <path>` before any subcommand (`xcrun simctl help`), which points it at a separate device set. Devices created in a per-run set did not appear in Xcode's default set (`simctl list devices booted` without `--set` listed none), and `simctl --set <path> shutdown all` followed by `delete all` removed only that set's devices and left the directory empty. Two devices of one set booted side by side. A simulator has no ports of its own, so concurrent runs cannot collide on ports. `simctl erase` resets a device's contents and settings for reuse (`xcrun simctl help erase`).

Xcode's own parallel testing goes the same way: `xcodebuild -parallel-testing-enabled` with `-parallel-testing-worker-count` spawns several test runners (`man xcodebuild`). The man page does not say how it provisions their simulators. All device sets are served by one `CoreSimulatorService` process per user session, so a hang there would affect every checkout; that was not observed, only inferred from the single process listed.

### Installing and launching the simulator build

`simctl install <device> <path>` installs an `.app` bundle, and `simctl launch` starts it by bundle identifier, passing extra arguments as `argv` and forwarding calling-environment variables prefixed with `SIMCTL_CHILD_` into the app (`xcrun simctl help launch`). A simulator build comes from `xcodebuild -project apps/mobile-app/ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath <dir> build`, which writes `App.app` under `Build/Products/Debug-iphonesimulator`. That build was not run here: the worktree had no `node_modules` or synced web assets, so build time and whether the `CupShare` extension signs for the simulator without a team are open.

### Reaching the host from the simulator

The simulator runs as processes on the Mac and uses the host's network stack. A Node server bound to `127.0.0.1` on an OS-assigned port (59174) received requests from Safari in the simulator for both `http://localhost:59174/` and `http://127.0.0.1:59174/`. No Apple page documenting this was found; a third-party post suggesting a `simctl networkinterface` command is wrong for this Xcode, which has no such subcommand. Because the simulator shares the host's loopback, there is no `adb reverse` equivalent and none is needed, but the app must learn the run's port, for example from a launch argument or `SIMCTL_CHILD_` variable.

Safari is not bound by the app's App Transport Security settings, so ATS needs separate attention. Apple documents that from iOS 10 "ATS allows all three of these connections by default", meaning unqualified domains, `.local` domains and IP addresses, and that "In iOS 17, iPadOS 17, and macOS 14, ATS no longer allows connections to IP addresses by default" ([`NSAllowsLocalNetworking`][apple-ats-local]). `localhost` is an unqualified domain, so `http://localhost:<port>` passes ATS on iOS 26 without an exception, while `http://127.0.0.1:<port>` would need one. Apple recommends setting `NSAllowsLocalNetworking` "as a declaration of intent" even where it is not required; doing that in debug builds only keeps release builds unchanged.

## Apple Silicon

The Android emulator uses Hypervisor.Framework on macOS, and VM acceleration needs a system image that matches the host CPU: "arm64-v8a system images for Android 5.0 (API level 21) and higher" on ARM64 ([Configure VM acceleration][android-accel]). Every installed image on this Mac is `arm64-v8a`. Turning acceleration off "is not supported and is very slow" ([`-accel`][android-cmdline]). The reference also notes that the `-sdcard` option "will not work on Mac with Apple Silicon" ([AVD data directory][android-cmdline]), which the suite does not need. iOS simulator runtimes run arm64 code natively; `simctl launch --arch` exists only to choose a slice of a universal binary (`xcrun simctl help launch`).

## Docker on macOS

Docker cannot host an accelerated Android emulator on a Mac:

- The acceleration guide states: "You can't run a VM-accelerated emulator inside another VM, such as a VM hosted by VirtualBox, VMWare, or Docker" ([Restrictions][android-accel]).
- Google's emulator container scripts are "intended to be run on a Linux OS", require that "KVM must be enabled on your host", and state that "Docker Desktop on macOS and Windows is not supported for KVM acceleration" ([android-emulator-container-scripts][container-scripts]).
- On this Mac, `/dev/kvm` did not exist inside a container, with or without `--privileged`.
- Apple's Virtualization framework has offered nested virtualization since macOS 15 on M3 and later ([`isNestedVirtualizationSupported`][apple-nested]), so the hardware here could support it, but Docker Desktop's Linux VM did not expose it.

Without KVM the emulator would fall back to unaccelerated emulation, which the emulator itself refuses to start unless `ANDROID_I_WANT_MY_TCG` is set ([`-accel`][android-cmdline]). The Playwright pattern of a shared container therefore does not carry over: emulators run on the host. The iOS simulator cannot run in Docker at all, because it is part of Xcode on macOS.

## Recommendation

Have the suite own its devices completely, mirroring how other suites own their servers:

1. **Android.** Prepare once per machine, outside the timed run, a suite-owned AVD under a suite-owned `ANDROID_AVD_HOME`, from the API 36 `arm64-v8a` image, with a Quick Boot snapshot taken after a clean first boot. Each run starts it with `-read-only -no-window -no-audio -no-boot-anim -report-console tcp:<os-assigned-port>`, reads its console port, polls `sys.boot_completed` with a timeout, installs the debug APK with `adb -s <serial> install -r`, and stops it with `adb -s <serial> emu kill`. If the snapshot is missing or does not load, the emulator cold-boots in about 15 s, which is slower but still correct, so this needs no retry. Never touch the developer's AVDs, never pass `-port`, and never run `adb kill-server`.
2. **iOS.** Each run creates a device set in a temporary directory, creates an iPhone device there from the installed runtime, boots it with `bootstatus -b`, installs and launches the simulator build, and deletes the whole set at the end. That costs about 18 s of first boot per run. If the budget needs it, a suite-owned template set can keep one prepared device that each run clones; a clone's first boot measured no faster here, so prefer the simpler fresh device unless later measurements show otherwise.
3. **Host server.** Start the test Worker on `127.0.0.1` with an OS-assigned port, as the other suites do. Android reaches it at `http://10.0.2.2:<port>`; iOS at `http://localhost:<port>`. Allow cleartext to those hosts only in debug builds (a debug-only Network Security Configuration on Android, `NSAllowsLocalNetworking` on iOS). Prefer `10.0.2.2` over `adb reverse` because it needs no per-boot step; keep `adb reverse` in mind if the Android app must use a `localhost` origin. Passing the port and origin into the apps needs a test-only override of the hardcoded `https://cup.audio`, for the spec to decide.
4. **Concurrency and cleanup.** Nothing in either platform forces a fixed port or a shared device, so concurrent checkouts are safe as long as each run tears down only what it created: kill its own emulators by serial and delete its own simulator set, including after a failed run.
5. **No Docker.** Run both device kinds on the host. The suite should check up front for the Android SDK emulator, a matching system image, Java 21 and Xcode with an iOS runtime, and fail with a clear message rather than retry.

Open points for the next tickets: the simulator build time and signing of the `CupShare` extension for the simulator, memory use with several emulators and simulators per checkout running at once, and how the test build receives the local Worker origin.

## Sources

Read 2026-11-06 unless noted.

- [Start the emulator from the command line][android-cmdline], Android Developers.
- [Emulator networking address space][android-net], Android Developers.
- [Configure hardware acceleration for the Android Emulator][android-accel], Android Developers.
- [Android Debug Bridge (adb)][adb], Android Developers.
- [Network security configuration][android-nsc], Android Developers.
- [Build-managed devices][android-gmd], Android Developers: Gradle-managed emulators with snapshots and ATD images, an alternative only if the suite becomes Gradle instrumented tests.
- [Capacitor configuration][capacitor-config], Capacitor 8 documentation.
- [`NSAllowsLocalNetworking`][apple-ats-local], Apple Developer Documentation (read through its JSON endpoint, as the page renders client-side).
- [`isNestedVirtualizationSupported`][apple-nested], Apple Developer Documentation (seen in search results).
- [google/android-emulator-container-scripts][container-scripts], README.
- Local tool help on the research date: `emulator -help`, `-help-port`, `-help-report-console`, `-help-read-only`; `adb --help`; `xcrun simctl help` and its `boot`, `bootstatus`, `clone`, `create`, `install`, `launch`, `io`, `erase` subcommands; `man xcodebuild`.

[android-cmdline]: https://developer.android.com/studio/run/emulator-commandline
[android-net]: https://developer.android.com/studio/run/emulator-networking-address
[android-accel]: https://developer.android.com/studio/run/emulator-acceleration
[adb]: https://developer.android.com/tools/adb
[android-nsc]: https://developer.android.com/privacy-and-security/security-config
[android-gmd]: https://developer.android.com/studio/test/managed-devices
[capacitor-config]: https://capacitorjs.com/docs/config
[apple-ats-local]: https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking
[apple-nested]: https://developer.apple.com/documentation/virtualization/vzgenericplatformconfiguration/isnestedvirtualizationsupported
[container-scripts]: https://github.com/google/android-emulator-container-scripts
