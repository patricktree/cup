# Uploading a test build to the internal testing track

Research date: 2026-11-14, for [issue #358](https://github.com/patricktree/cup/issues/358) of the [Android test builds map](https://github.com/patricktree/cup/issues/355). Repository observations are from `main` at `8e5c815d`: Capacitor `^8.5.3`, Android Gradle Plugin (AGP) `8.13.0`, Gradle wrapper `8.14.3`, `versionCode 1` hard-coded in `apps/mobile-app/android/app/build.gradle`, no CI workflows, and macOS system Ruby `2.6.10` on the operator's Mac. Tool versions are the latest releases on the research date: Gradle Play Publisher (GPP) `4.1.2` (2026-11-12, tag commit `d58fb4c3`) and `3.13.0` (2025-12-08, tag commit `01663c5c`), fastlane `2.241.2` (2026-10-26, tag commit `a540df30`), `googleapis` `190.0.0` and `@googleapis/androidpublisher` `42.3.1` (both 2026-11-12, `engines.node >=22`). Google's API reference and Play Console Help pages carry no visible revision date; they were read on the research date. Nothing was uploaded: Cup has no Play Console app yet, so every API behaviour below is read from documentation or tool source, and the points marked _unverified_ need the first real upload.

## Question

What are the ways to upload a release-signed `.aab` to the internal testing track and release it to testers from the operator's Mac: a manual upload in the Play Console, or a script through the Google Play Developer API (GPP, `fastlane supply`, or a small Node script with `googleapis`)? For each: what it needs (service account, Play Console permissions, where the key lives), whether it can do the very first upload, whether it can create and roll out an internal release in one step, whether it can read the highest `versionCode` already uploaded, and how it fits a pnpm and Turbo monorepo without Ruby or extra toolchains.

## Answer

**The first upload must be manual, in the Play Console, whichever mechanism follows.** Google's API guide says "you will have to upload at least one APK through the Play Console before you can use this API" and that the API only changes "an _existing_ app (that has at least one APK uploaded)" ([edits guide](https://developers.google.com/android-publisher/edits)). GPP, fastlane and the API reference agree; nothing creates an app record or its first artifact through the API. That first upload is also when Play App Signing enrols the app (see [Play App Signing on the first upload](#play-app-signing-on-the-first-upload)), so the spec's first-upload step is a manual Console step anyway.

**Every later upload can be scripted, and all three scripted options do the same four API calls**: insert an edit, upload the bundle, update the `internal` track with a release of status `completed`, commit the edit. That creates and rolls out the internal release in one run. One reported caveat, _unverified_ from a Google page: while the app is still in _Draft_ status (never rolled out on any track), the API accepts only releases of status `draft`, so the very first internal release has to be rolled out in the Console. Both happen during the manual first upload, so after it the API can roll out `completed` releases.

**The API can read the highest `versionCode`, with one gap.** `edits.tracks.list` returns every active release on every track with its `versionCodes`, and `edits.bundles.list` "lists all current Android App Bundles of the app and edit", each with its `versionCode`. GPP's `ResolutionStrategy.AUTO` and fastlane's `google_play_track_version_codes` both take the maximum over tracks. Whether `bundles.list` also returns bundles that were uploaded but never reached a release (a failed or discarded edit), and therefore whether the maximum over tracks can miss a used code, is _unverified_; Play rejects a re-used `versionCode`, so the maximum over both lists is the safe read.

**For Cup the recommendation is a small Node script with `@googleapis/androidpublisher`**, run as a pnpm script in `@cup/mobile-app` after the Gradle `bundleRelease` build. It adds one npm dependency and no toolchain, keeps the build and the upload separate steps, and is about 40 lines of TypeScript (sketch below). GPP is the strongest alternative, since it lives inside the Gradle build that already exists, but Cup has to stay on GPP 3.13.0 until it moves to AGP 9. fastlane needs Ruby 3.2 or newer, which the Mac does not have, and is the poorest fit.

| Criterion                            | Play Console (manual)                        | Gradle Play Publisher                                                                  | `fastlane supply`                                                               | Node + `@googleapis/androidpublisher`                         |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Very first upload                    | Yes, and required                            | No: "needs to be uploaded via the Google Play Console"                                 | No: needs "at least one build" uploaded manually                                | No (same API rule)                                            |
| Upload and roll out in one step      | Yes (Create release, upload, Save, Roll out) | Yes: `publishReleaseBundle`, track `internal` and status `COMPLETED` are the defaults  | Yes: `upload_to_play_store` with `track: internal`, `release_status: completed` | Yes: four calls, one edit                                     |
| Reads highest uploaded `versionCode` | Visible in the App bundle explorer           | Yes: `ResolutionStrategy.AUTO`, maximum over all tracks                                | Yes: `google_play_track_version_codes`, per track                               | Yes: `edits.tracks.list` and `edits.bundles.list`             |
| Credentials                          | The operator's Google account                | Service account JSON key: file or `ANDROID_PUBLISHER_CREDENTIALS`, or ADC              | Service account JSON key (`json_key`) or Workload Identity                      | Service account JSON key or ADC through `google-auth-library` |
| Extra toolchain on the Mac           | None                                         | None (Gradle plugin); GPP 4 needs AGP 9 and Gradle 9.1                                 | Ruby 3.2+ through rbenv or Homebrew, Bundler, `Gemfile`                         | None (Node 22+, already required)                             |
| Fit with pnpm and Turbo              | Not scriptable                               | A Gradle task called from a pnpm script                                                | Ruby project beside the workspace                                               | A pnpm script and one dependency; TypeScript types included   |
| Maintenance                          | First-party                                  | Maintenance mode: "Issues are ignored, but pull requests are not"; released 2026-11-12 | Active; released 2026-10-26                                                     | Generated first-party client; released 2026-11-12             |

## The Play Developer API flow

All scripted options wrap the Publishing API's edits. An edit "starts as a copy of the app's currently deployed state", collects changes, and makes them live on commit ([edits guide](https://developers.google.com/android-publisher/edits)). For an internal release:

1. `edits.insert` creates the edit.
2. `edits.bundles.upload` posts the `.aab` to `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{packageName}/edits/{editId}/bundles` and returns `versionCode`, `sha1` and `sha256` ([reference](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload)). The old `ackBundleInstallationWarning` parameter is deprecated: "it's not necessary to set this field anymore". The page states no MIME type or size limit; GPP and fastlane both send `application/octet-stream`.
3. `edits.tracks.update` (or `patch`) on track `internal` sets `releases[]` to one release with `versionCodes: [<new code>]` and `status: "completed"`. The status enum is `draft` ("APKs are not being served to users"), `inProgress` and `halted` (staged rollouts with `userFraction`), and `completed` ("will have no further changes") ([Track resource](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks)). `name` is optional and defaults to the `versionName`; `releaseNotes[]` is optional.
4. `edits.commit` makes it live. By default, `changesInReviewBehavior` is `CANCEL_IN_REVIEW_AND_SUBMIT`: a pending review elsewhere in the app is cancelled and resubmitted together with this edit; `ERROR_IF_IN_REVIEW` fails instead ([reference](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit)). For internal-only test builds there is normally nothing in review, so the default is fine; `ERROR_IF_IN_REVIEW` is the safer choice once closed testing or production releases exist (CUP-46).

All calls use the scope `https://www.googleapis.com/auth/androidpublisher`. The Play Console Help says internal releases are available to testers "within minutes" and "might not be subject to standard Play policy or security reviews" ([internal testing](https://support.google.com/googleplay/android-developer/answer/9845334)).

### Reading the highest versionCode

`edits.tracks.list` returns each track with `releases[]` that, "in a read request, … lists all active releases on the track", each with its `versionCodes[]` ([Track resource](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks)). `edits.bundles.list` "lists all current Android App Bundles of the app and edit" as `Bundle` objects with `versionCode`, `sha1` and `sha256` ([reference](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles)). A newer, non-edit endpoint, `applications.tracks.releases.list`, "returns the list of all releases for a given track", excluding obsolete ones, as `ReleaseSummary` objects with `activeArtifacts` (from the `@googleapis/androidpublisher` 42.3.1 type definitions). A read-only edit that is never committed is enough for these reads; an uncommitted edit expires on its own.

How the tools read it:

- GPP: `findMaxAppVersionCode()` calls `listTracks`, picks the track whose releases hold the largest code, and returns that maximum, defaulting to 1 ([`DefaultEditManager.kt`](https://github.com/Triple-T/gradle-play-publisher/blob/d58fb4c3bec5b2fdeeb470d99c0a6f0e70883ab6/play/android-publisher/src/main/kotlin/com/github/triplet/gradle/androidpublisher/internal/DefaultEditManager.kt), [`TrackManager.kt`](https://github.com/Triple-T/gradle-play-publisher/blob/d58fb4c3bec5b2fdeeb470d99c0a6f0e70883ab6/play/android-publisher/src/main/kotlin/com/github/triplet/gradle/androidpublisher/internal/TrackManager.kt)). `ResolutionStrategy.AUTO` uses it to "automatically pick the correct version code so you don't have to manually update it" ([README](https://github.com/Triple-T/gradle-play-publisher/blob/d58fb4c3bec5b2fdeeb470d99c0a6f0e70883ab6/README.md#handling-version-conflicts)).
- fastlane: `track_version_codes(track)` gets one track and flattens its releases' `version_codes` ([`client.rb`](https://github.com/fastlane/fastlane/blob/a540df301c4ada0621cdb50358049734712f7ee7/supply/lib/supply/client.rb)); the `google_play_track_version_codes` action exposes it per track ([docs](https://docs.fastlane.tools/actions/upload_to_play_store/)).

Neither tool reads `bundles.list`, so both can miss a code that was uploaded but never reached an active release. _Unverified_: whether Play then rejects that code on the next upload (the documented rule is only that codes must increase) and whether `bundles.list` returns such bundles. The choice of versioning scheme belongs to the versioning ticket of the map; this page only establishes that the API can supply the current maximum.

### The Draft-app restriction

Play Console Help says a _Draft_ app "has no presence on Google Play" and that "when you're ready to publish a draft app, you'll need to roll out a release" ([app status](https://support.google.com/googleplay/android-developer/answer/9859751)). Developers widely report that, while the app is in Draft, the API rejects non-draft releases with "Only releases with status draft may be created on draft app" and that rolling out the first internal release in the Console clears it ([Microsoft Q&A](https://learn.microsoft.com/answers/questions/822890/34only-releases-with-status-draft-may-be-created-o.html), [FlutterFlow docs](https://docs.flutterflow.io/google-play-draft-release-error)). I found no Google page stating this, so it is _unverified_ from a primary source. It does not change the plan: the first upload and its rollout happen in the Console anyway.

Two Console-side facts from the [internal testing page](https://support.google.com/googleplay/android-developer/answer/9845334) bear on that first rollout: "You can start an internal test before completing app setup", and "the opt-in link displays only when an app status is 'Published'", so testers get the link only after the first rollout.

### Play App Signing on the first upload

For a new app, Play App Signing is the default: "your app is automatically enrolled in quantum-ready, hybrid signing with Google-generated keys", with an opt-out before the first open-testing or production rollout ([Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756)). The app signing certificate's SHA-1 and SHA-256 are shown in the Console under Play app signing; with hybrid signing there are three keys to register. The page describes no API for reading the fingerprints. This belongs to the signing and sign-in tickets of the map; it matters here only because it is another reason the first upload is a Console step.

## Service account and permissions

All three scripted options authenticate as a Google Cloud service account that the Play Console has invited as a user ([getting started](https://developers.google.com/android-publisher/getting_started)):

1. Create or pick a Google Cloud project and enable the Google Play Android Developer API.
2. Create a service account in it. GPP's guide gives it the Project Owner role temporarily and removes it after the first successful call ([README](https://github.com/Triple-T/gradle-play-publisher/blob/d58fb4c3bec5b2fdeeb470d99c0a6f0e70883ab6/README.md#service-account)); Google's page asks for no Cloud IAM role at all, so I expect none is needed, _unverified_.
3. Create a JSON key for it, or use Application Default Credentials (ADC) through `gcloud` impersonation instead of a key file. Both GPP (`useApplicationDefaultCredentials`) and `google-auth-library` support ADC.
4. In Play Console, **Users and permissions**, invite the service account's email and grant app-level permissions for Cup only.

The smallest app-level permission set for this job, from the [permission list](https://support.google.com/googleplay/android-developer/answer/9844686):

- **Release apps to testing tracks**: "Upload draft apps. Create, edit, and roll out releases to testing tracks." It "does not allow users to publish apps to production".
- **View app information (read-only)**, which the edits reads rely on. _Unverified_ whether "Release apps to testing tracks" already implies it.
- Not needed: **Manage testing tracks and edit tester lists** (tester lists are a one-time Console task of the map) and **Release to production, exclude devices, and use Play App Signing**.

**Where the key lives.** The key is a long-lived credential that can release to testing tracks, so it stays outside the repository, like the upload keystore. GPP warns: "If you commit unencrypted Service Account keys to source, you run the risk of letting anyone access your Google Play account", and reads the key from the `ANDROID_PUBLISHER_CREDENTIALS` environment variable instead ([README](https://github.com/Triple-T/gradle-play-publisher/blob/d58fb4c3bec5b2fdeeb470d99c0a6f0e70883ab6/README.md#authenticating-gradle-play-publisher)). For a Node script the equivalent is a key file path in a Git-ignored env file or `GOOGLE_APPLICATION_CREDENTIALS`, read by `GoogleAuth`. A Google Cloud organisation policy, `iam.disableServiceAccountKeyCreation`, can block key creation; whether it applies to Cup's Cloud project was not checked (not read from a Google page in this research), and ADC impersonation avoids keys altogether.

## Each option

### Manual upload in the Play Console

**Test and release > Testing > Internal testing**: set up the tester list and feedback contact on the **Testers** tab, then create a release, upload the `.aab`, save and roll out ([internal testing](https://support.google.com/googleplay/android-developer/answer/9845334)). It needs only the operator's account, does the first upload, and shows version codes in the App bundle explorer. It is the required path for the first build and a fine fallback, but it is not a repeatable command, which the map's destination asks for.

### Gradle Play Publisher

A Gradle plugin, `com.github.triplet.play`, applied in `apps/mobile-app/android/app/build.gradle` (a file Capacitor does not regenerate). `./gradlew publishReleaseBundle` builds and uploads the release bundle; `track` defaults to `internal` and `releaseStatus` to `COMPLETED`, so the default configuration already is "upload and roll out to internal testers" ([README](https://github.com/Triple-T/gradle-play-publisher/blob/d58fb4c3bec5b2fdeeb470d99c0a6f0e70883ab6/README.md)). `--artifact-dir` uploads an already built bundle instead. `resolutionStrategy AUTO` can rewrite the `versionCode` to the next free one at build time.

Constraints:

- **Version line.** GPP 4.0.0 is for AGP 9: "Compatibility with older AGP or Gradle versions is not supported—stay on GPP 3.x if you don't wish to upgrade" ([4.0.0 release](https://github.com/Triple-T/gradle-play-publisher/releases/tag/4.0.0)). Its validator requires Gradle 9.1.0 and AGP 9.0 ([`MinDeps.kt` at 4.1.2](https://github.com/Triple-T/gradle-play-publisher/blob/d58fb4c3bec5b2fdeeb470d99c0a6f0e70883ab6/common/validation/src/main/kotlin/com/github/triplet/gradle/common/validation/MinDeps.kt)). GPP 3.13.0 requires Gradle 7.0.2 and AGP 7.0 ([`MinDeps.kt` at 3.13.0](https://github.com/Triple-T/gradle-play-publisher/blob/01663c5c399b671fca113c1665cf29c0ab3f454d/common/validation/src/main/kotlin/com/github/triplet/gradle/common/validation/MinDeps.kt)). Cup's AGP 8.13 and Gradle 8.14.3 therefore need 3.13.0, and a Capacitor upgrade to AGP 9 forces a GPP major upgrade with it.
- **Maintenance mode.** The README states "Project status: maintenance mode" and "Issues are ignored, but pull requests are not"; releases still ship (4.1.2 on 2026-11-12 added retries on 5xx responses).
- **Turbo.** A `publishReleaseBundle` task uploads as a side effect, so it must never be a cached Turbo task; it would be a plain pnpm script, as `android:run` is today.

### fastlane supply

`upload_to_play_store` (alias `supply`) takes `aab`, `track` (default `production`, so `internal` must be set), `release_status` (`completed`, `draft`, `halted`, `inProgress`) and `json_key` ([docs](https://docs.fastlane.tools/actions/upload_to_play_store/)). It "need[s] to set up your app manually first by uploading at least one build". `fastlane run validate_play_store_json_key` checks the key.

fastlane "supports Ruby versions 3.2 or newer" and advises against macOS system Ruby, recommending rbenv or Homebrew Ruby, Bundler and a committed `Gemfile.lock` ([Android setup](https://docs.fastlane.tools/getting-started/android/setup/)). The operator's Mac has system Ruby 2.6.10 only, so fastlane brings a Ruby toolchain and a second lockfile into a pnpm repository for a job that is four HTTP calls. Its strengths (metadata, screenshots, iOS `deliver`) are out of scope for this map; CUP-79 could reconsider it for TestFlight, but `xcrun altool` or the App Store Connect API are the comparable choices there.

### Node script with googleapis

`@googleapis/androidpublisher` is the standalone package for this one API (`googleapis` bundles all Google APIs). Version 42.3.1 depends only on `googleapis-common`, ships TypeScript types, requires Node 22 or newer, and documents `edits.insert`, `edits.bundles.upload` with a `media` body, `edits.bundles.list`, `edits.tracks.update` and `edits.commit` in its type definitions. `google-auth-library` (11.3.4) reads a service account key or ADC. The script can live in `apps/mobile-app` as a `play:upload` pnpm script beside `android:run`, typed and linted like the rest of the repository, and run by Node's type stripping.

A sketch of the upload, not run against Play:

```ts
import { androidpublisher, auth } from "@googleapis/androidpublisher";
import { createReadStream } from "node:fs";

const packageName = "audio.cup.app";
const client = androidpublisher({
  version: "v3",
  auth: new auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidpublisher"] }),
});

const { data: edit } = await client.edits.insert({ packageName });
const editId = edit.id!;
const { data: bundle } = await client.edits.bundles.upload({
  packageName,
  editId,
  media: { mimeType: "application/octet-stream", body: createReadStream(aabPath) },
});
await client.edits.tracks.update({
  packageName,
  editId,
  track: "internal",
  requestBody: {
    track: "internal",
    releases: [{ versionCodes: [String(bundle.versionCode)], status: "completed" }],
  },
});
await client.edits.commit({ packageName, editId });
```

Reading the highest code is the same client with `edits.tracks.list` and `edits.bundles.list` on a fresh edit. The package's `index.d.ts` exports the `androidpublisher` factory and an `auth` (`AuthPlus`) object, as used above; whether `auth.GoogleAuth` is the right constructor on it is _unverified_. Also _unverified_: upload behaviour for large bundles (the client streams the body; resumable upload is not configured here), and the exact error a re-used `versionCode` returns.

## Open points for the spec

- The first upload, Play App Signing enrolment and the first internal rollout are one manual Console session; the spec should describe it once.
- Decide whether the upload script also reads the highest `versionCode` (for a check or for the versioning scheme) or only uploads.
- Decide where the service account key or ADC configuration lives, and add it to the production-configuration guide next to the upload keystore.
- Confirm on the first scripted upload: the Draft-app restriction is gone, "Release apps to testing tracks" plus read access is enough, and `bundles.list` includes bundles without a release.
