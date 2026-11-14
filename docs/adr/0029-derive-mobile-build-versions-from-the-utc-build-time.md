---
status: accepted
---

# Derive mobile build versions from the UTC build time

Every upload to Google Play needs a `versionCode` higher than any uploaded before, and Play never accepts a code twice; `versionName` is what testers see. Until now both were hard-coded in the Android app (`1` and `"1.0"`), as were iOS's `CURRENT_PROJECT_VERSION` and `MARKETING_VERSION`, and no other part of Cup carries a version. The map [patricktree/cup#355](https://github.com/patricktree/cup/issues/355), answering Linear CUP-80, decided the scheme on 2026-11-14 in [#359](https://github.com/patricktree/cup/issues/359), so that Linear CUP-79 can reuse it for iOS. It is not implemented yet.

## Decision

- **`versionCode` is the number of whole minutes since `2026-01-01T00:00Z` at the UTC build time**, for example `457310` on 2026-11-14. It rises on every build whatever the branch, needs no commit and no Play API, and a rebuild of the same commit gets a new code. Play's cap of 2,100,000,000 lies thousands of years away.
- **`versionName` is the same instant as a zero-padded calendar date `YYYY.MM.DD`**, for example `2026.05.08`. Two builds on one day share a name and differ by `versionCode`.
- **The commit goes in the Play release name**, as `<versionName> (<short SHA>)`, for example `2026.11.14 (8e5c815)`. The app shows no version of its own.
- **The release build command sets both.** It reads the UTC time once and passes both values to Gradle as `-PcupVersionCode` and `-PcupVersionName`; a release build fails when either is missing. Debug builds keep fixed values (`versionCode 1`, `versionName "0.0.0"`), so local `adb` builds and the mobile E2E suite's Turbo cache keys stay stable.
- **iOS reuses the scheme**: the same integer as `CFBundleVersion` and the same date as `MARKETING_VERSION`.
- **The version belongs to the mobile build only.** The web app and the Worker get no version, and a mobile build promises no particular Worker deploy.

## Considered options

- **A counter bumped by hand and committed.** Rejected: every upload needs a commit, and two branches can bump to the same number.
- **The commit count on `main`.** Rejected: one commit cannot be uploaded twice, for example after a failed upload, and a build cut from a branch can collide or go backwards.
- **The highest code on Play plus one.** Rejected: the first upload must be manual in the Play Console ([#358](https://github.com/patricktree/cup/issues/358)), and building would depend on Play credentials.
- **Plain Unix seconds.** Rejected: they pass Play's cap on 2036-07-18, after which the app could take no further upload.
- **Unix minutes.** Equally safe; the operator preferred a 2026 epoch, which keeps the codes small.

## Consequences

- The scheme cannot be lowered: any later scheme must produce codes above every code already on Play, for both Android and iOS.
- Two builds in the same minute collide, and Play rejects the second.
- A `versionCode` says nothing about its commit; the Play release name links the two.
- Apple reads each version component as an integer and is reported to ignore leading zeros, so `2026.05.08` compares as `2026.5.8`, which still orders correctly; only digits and periods, at most three components, are allowed ([Apple glossary](https://developer.apple.com/help/glossary/version-number), [Apple forums](https://developer.apple.com/forums/thread/772100), [Twitch engineering, 2016](https://medium.com/twitch-news/ios-versioning-89e02f0a5146)). Unconfirmed as of 2026-11-14; Linear CUP-79 confirms it on its first TestFlight upload.
