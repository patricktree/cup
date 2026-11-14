# Google Play requirements before the first internal testing release

Research date: 2026-11-14, for [issue #356](https://github.com/patricktree/cup/issues/356) of the [Android test builds map](https://github.com/patricktree/cup/issues/355). Repository observations are from `main` at `8e5c815d`: `apps/mobile-app/android` builds `audio.cup.app` with `minSdkVersion 24`, `compileSdkVersion 36`, `targetSdkVersion 36`, Android Gradle plugin `8.13.0` and Gradle `8.14.3`; the `release` build type has no signing config. All web sources are Google's own (Play Console Help, Android developers) and were read on the research date. No Play Console account was opened or changed, so everything the Console shows only to a signed-in developer is _unverified_; those points are marked.

## Question

What must be in place before Cup's first release reaches Google Play's internal testing track? The ticket asks about developer account types (identity verification, D-U-N-S, fees, public developer details, the 12-tester rule for new personal accounts, changing the type later), which App content declarations block an internal release, how the internal testing track works, how Play App Signing enrolment works on the first upload, and which current upload requirements a first `.aab` must meet with `targetSdkVersion 36` and `minSdkVersion 24`.

## Answer

The internal testing track needs very little: a developer account with verified identity (and, for a personal account, a verified Android device), an app record, and a release-signed `.aab` uploaded to the internal track with an email list of up to 100 testers. Google says "You can start an internal test before completing app setup", internal tests "might not be subject to standard Play policy or security reviews", and a new bundle reaches testers "within minutes" ([Set up an open, closed, or internal test][testing]). Apps active only on internal testing are exempt from the Data safety form ([Data safety][data-safety]). Play App Signing is configured by the first upload itself: Google generates the app signing key by default, and the key that signed the first `.aab` becomes the upload key ([Sign your app][app-signing]). Cup's `targetSdkVersion 36` already meets the requirement in force since 31 August 2026, and `minSdkVersion 24` is not restricted by Play.

The account type is the decision with lead time. A personal account is quicker to open but publishes the operator's legal name, country and email on Google Play, and, created after 13 November 2023, must run a closed test with 12 opted-in testers for 14 consecutive days before it can apply for production ([testing requirements][personal-testing]). That rule does not block internal testing, but it blocks the production release in [CUP-46](https://linear.app/cup-audio/issue/CUP-46/publish-the-android-app-to-google-play). An organization account needs a D-U-N-S number (free, "can take up to 30 days") and a verified website. A personal account can later become an organization account, but not the reverse ([Change account type][change-type]).

| Requirement                                                      | Blocks the first internal release?                                               | Source                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| Developer account, US$25 fee, verified ID                        | Yes                                                                              | [Register][register], [Verify][verify]         |
| Android device verification (personal only)                      | Yes, "before they can publish apps"                                              | [Verify][verify]                               |
| App record (name, policies, App signing ToS)                     | Yes                                                                              | [Create and set up your app][create-app]       |
| Release-signed `.aab`, Play App Signing                          | Yes; configured during the first release                                         | [Sign your app][app-signing]                   |
| Target API level 36                                              | Yes; Cup already targets 36                                                      | [Target API level][target-api]                 |
| 16 KB page size                                                  | No today; updates blocked from 1 February 2027 if unsupported                    | [16 KB page sizes][page-sizes]                 |
| Data safety form                                                 | No; internal-only apps are exempt                                                | [Data safety][data-safety]                     |
| Privacy policy, ads, target audience, content rating, app access | Not confirmed; Google says internal tests can start before app setup is complete | [Testing][testing], [App content][app-content] |
| 12 testers for 14 days in a closed test                          | No; blocks production for new personal accounts                                  | [Testing requirements][personal-testing]       |

## Developer account types

### What each type needs

Every account needs a Google Account, an owner aged 18 or older, acceptance of the Developer Distribution Agreement and "a US$25 one-time registration fee" by card (no prepaid cards). Identity verification may need "a valid government ID and a credit card, both in your legal name", and the fee is not refunded if the information is invalid ([Register for a Play Console developer account][register]).

| Area                          | Personal account                                                                                                          | Organization account                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity document             | An official government identity document                                                                                  | D-U-N-S number, a government identity document and an official organization document                                                                |
| D-U-N-S                       | Not required                                                                                                              | Required: "You can't create an organization developer account without a valid D-U-N-S number"; free from Dun & Bradstreet, "can take up to 30 days" |
| Verified by one-time password | Contact email, contact phone, developer email                                                                             | Contact email and phone, developer email, developer phone                                                                                           |
| Android device                | Must verify "access to a real Android mobile device" with the Play Console mobile app                                     | Not required                                                                                                                                        |
| Shown on Google Play          | Developer name, legal name, country, developer email; full address if the app is monetized; phone only with trader status | Developer name, legal name, D-U-N-S number, legal address, developer email, developer phone                                                         |
| Testing before production     | Closed test, 12 testers, 14 days (accounts created after 13 November 2023)                                                | Not required                                                                                                                                        |

Sources: [Required information to create a developer account][required-info], [Verify your developer identity][verify], [Choose a developer account type][account-type], [Testing requirements for new personal accounts][personal-testing]. Legal name and address come from the linked Google payments profile ([Required information][required-info]). Both types also declare trader status for the EU; Cup is not monetized, so the trader-related address and phone rules are a production question.

How long identity verification takes: no Google page read here states a duration for identity documents; only the D-U-N-S application ("up to 30 days") and bank verification for monetizing accounts ("up to five days") are stated ([Required information][required-info]). Verification is required: "You must verify your developer account before you can submit apps for consideration on Google Play" ([Verify][verify]). The duration is _unverified_ and is worth budgeting for in the account ticket.

### The 12-tester rule

Personal accounts created after 13 November 2023 must, when applying for production access, have "at least 12 testers" opted in to a closed test who "have been opted in continuously for the preceding 14 days"; testers who leave early do not count, and opting out and back in restarts the clock. The operator then clicks **Apply for production** on the Dashboard; Google usually reviews within seven days and may ask for a longer test if engagement was too low. Approval unlocks production and open testing ([App testing requirements for new personal developer accounts][personal-testing]). The page names personal accounts only; [Register][register] also states the testing requirement for personal accounts only, so organization accounts are exempt by omission. Closed testing itself requires app setup to be complete, unlike internal testing ([Testing][testing]).

### Changing the type later

Personal to organization is supported, in place, by the account owner: the account must be fully verified with no pending warnings, the owner verifies the organization's website under **Manage account > Account details > About you**, after which **Change account type** appears; an organizational payments profile with the D-U-N-S number is linked, and Google advises waiting "at least 72 hours after the transition is complete before you submit any new apps". The reverse is not possible: "You can't change the account type from an organization to an individual account"; that needs a new account and an app transfer ([Change your developer account type][change-type]). Whether a converted account still owes the 12-tester closed test is not stated on either page and is _unverified_.

## App content declarations

Google's internal testing page says "You can start an internal test before completing app setup" and "You can also use internal testing to test apps that are not fully configured" ([Testing][testing]). The App content page lists the declarations (privacy policy, ads, sign-in details for restricted parts, target audience and content, permissions declarations for sensitive permissions, content rating) and says to "submit mandatory safety, policy, and legal declarations before publishing", without saying which tracks each one gates ([Prepare your app for review][app-content]). The content rating page requires the questionnaire for "New apps submitted to Google Play Console" without naming tracks ([Content ratings][content-rating]).

The only declaration Google explicitly waives for internal testing is Data safety: "Apps that are exclusively active on this track do not need to complete the Data safety form" ([Data safety][data-safety]). A privacy policy is required to complete that form, so for an internal-only app Google states no privacy policy requirement either way.

What this means for Cup, partly _unverified_: Google's text supports releasing to internal testing before the App content tasks are done, and holding them, together with the store listing, for [CUP-46](https://linear.app/cup-audio/issue/CUP-46/publish-the-android-app-to-google-play). Whether the Console's publishing checks still insist on any of them for an internal release (the content rating and target audience are the likeliest) can only be confirmed in a real Console; the first-upload step of the spec should note that it may have to fill in some declarations. Cup's manifest requests only `android.permission.INTERNET`, so no permissions declaration form applies. Cup restricts content behind Google sign-in, so the **App access** (sign-in details) declaration will be needed for review before production.

## Internal testing track

- **Testers:** "up to 100 testers per app", added by email list or CSV under **Test and release > Testing > Internal testing > Testers > Create email list**. Google Groups are described for closed tests only, with no size limit there; Google does not state whether internal testing accepts a Group, so treat internal testing as email lists only. Testers need "a Google Account or a Google Workspace account" ([Testing][testing]).
- **Opt-in link:** each tester opts in through the shareable link, which "displays only when an app status is 'Published'"; testers cannot find the app by search ([Testing][testing]).
- **Review:** "Internal tests might not be subject to standard Play policy or security reviews" ([Testing][testing]). Device exclusion rules do not apply to internal testers, who can be anywhere.
- **Speed:** a new bundle "becomes available to testers within minutes"; first-time uploads are available immediately but show a temporary name and store listing "for up to 48 hours" ([Testing][testing]).
- **Interplay with other tracks:** someone opted in to the internal test is not eligible for closed or open tests until they opt out of it ([Testing][testing]). The 12-tester closed test therefore needs its own testers or opt-outs.
- **Package name:** "Once you upload an artifact, the package name for that app is fixed" ([Testing][testing]), so `audio.cup.app` is final at the first upload.
- Internal app sharing is a different feature (links per artifact, any signing key, expire after 60 days); its uploads cannot be promoted to a track ([Internal app sharing][internal-sharing]). It is not the track the map asks for.

## Play App Signing

New apps must use it: "configuring Play App Signing is required to sign your app for distribution through Google Play (except for apps created before August 2021)" ([Sign your app][app-signing]). App creation requires accepting the Play App Signing terms ([Create and set up your app][create-app]).

**Enrolment on the first upload.** Upload a bundle signed with a key the operator generates. If nothing else is chosen, "The key you use to sign your first release becomes your upload key" and Google generates the app signing key ([Sign your app][app-signing]). Play Console Help now describes the default for new apps as "quantum-ready, hybrid signing with Google-generated keys", which "combines a classical RSA 4096-bit key and a post-quantum ML-DSA-65 key"; devices on Android 17 or higher verify the post-quantum signature, older ones the classical blocks ([Use Play App Signing][play-app-signing]).

**Google-generated versus uploaded key.** Google-generated is the default. To use another app's key or upload a copy of an own key, choose **Change key** on the Play app signing page (**Protected with Play > Play Store protection > Manage Play app signing**) after uploading the bundle and "before a release is rolled out in the open testing or production track" ([Use Play App Signing][play-app-signing]). So an internal release does not lock the choice; an open or production release does. Google recommends supplying an own key only to sign the same app for other stores; with a Google key, a signed universal APK can be downloaded from the Console instead ([Upgrade or reset keys][key-reset]). Google never hands out a copy of the app signing key ([Sign your app][app-signing]).

**Certificates for Google sign-in.** The MD5, SHA-1 and SHA-256 fingerprints of the upload and app signing certificates are on the Play app signing page ([Sign your app][app-signing]). With hybrid signing, Google says to "copy the fingerprints for three keys and register each of them with your API providers" ([Use Play App Signing][play-app-signing]). Which of the three a Google Cloud Android OAuth client accepts (it takes one SHA-1 per client) is _unverified_; the likely answer is the classical RSA certificate's SHA-1, and the spec should check this against the Console when the app record exists.

**Losing the upload key.** The upload key can be reset; the app signing key held by Google is untouched: create a new upload key, export its certificate with `keytool -export -rfc … -file upload_certificate.pem`, and on the Play app signing page choose **Request upload key reset**, give a reason and upload the PEM ([Use Play App Signing][play-app-signing], [Sign your app][app-signing]). Configuring Play App Signing needs admin permission. Neither page states how long a reset takes before the new key is accepted; _unverified_.

**Key hygiene.** Google recommends a key valid for "at least 25 years", different upload and app signing keys, and keeping passwords out of build files with a separate `keystore.properties` loaded by `build.gradle` and kept out of source control ([Sign your app][app-signing]).

## Upload requirements for the first `.aab`

- **Format:** "From August 2021, new apps are required to publish with the Android App Bundle"; the compressed download of the APKs generated for a device may not exceed 4 GB ([About Android App Bundles][app-bundle]).
- **Target API level:** "New apps and app updates must target Android 16 (API level 36) or higher" since 31 August 2026, with extensions to 1 November 2026 on request ([Target API level requirements][target-api]). Cup's `targetSdkVersion 36` complies, and the 36 requirement will hold until the next annual raise, presumably in August 2027.
- **Minimum SDK:** no Play requirement on `minSdkVersion` was found; `24` is fine.
- **16 KB page size:** "all apps targeting Android 15 (API level 35) and higher must support 16 KB memory page sizes on 64-bit devices", and "Starting February 1, 2027, if your app updates don't support 16 KB memory page sizes, you won't be able to release these updates" ([Support 16 KB page sizes][page-sizes]). Apps with only Java or Kotlin code comply already; native libraries need 16 KB alignment, which AGP 8.5.1 or higher handles for packaging. Cup builds with AGP 8.13.0; whether any Capacitor plugin ships `.so` files is _unverified_ (check with `bundletool dump config --bundle=<aab> | grep alignment` or the APK Analyzer).
- **Not debug-signed:** Google Play does not accept apps signed with the debug certificate ([Sign your app][app-signing]); `versionCode` must rise with every upload (a general Play rule not re-read here).

## Limits

- No Play Console was opened; the Console's own publishing checks for an internal release, the exact identity verification duration, the upload key reset turnaround and the fingerprints shown under hybrid signing are _unverified_.
- Help Center pages were read through a summarizing fetch, so quotes are short; the Console navigation labels differ between the Help Center (**Protected with Play > Play Store protection**) and the Android developers page (**Release > Setup > App signing**), and the Console may show either.
- Google's separate Android developer verification for apps installed outside Google Play was not researched; it does not apply to Play distribution.

[account-type]: https://support.google.com/googleplay/android-developer/answer/13634885?hl=en
[app-bundle]: https://developer.android.com/guide/app-bundle
[app-content]: https://support.google.com/googleplay/android-developer/answer/9859455?hl=en
[app-signing]: https://developer.android.com/studio/publish/app-signing
[change-type]: https://support.google.com/googleplay/android-developer/answer/16260648?hl=en
[content-rating]: https://support.google.com/googleplay/android-developer/answer/188189?hl=en
[create-app]: https://support.google.com/googleplay/android-developer/answer/9859152?hl=en
[data-safety]: https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
[internal-sharing]: https://support.google.com/googleplay/android-developer/answer/9844679?hl=en
[key-reset]: https://support.google.com/googleplay/android-developer/answer/7384423?hl=en
[page-sizes]: https://developer.android.com/guide/practices/page-sizes
[personal-testing]: https://support.google.com/googleplay/android-developer/answer/14151465?hl=en
[play-app-signing]: https://support.google.com/googleplay/android-developer/answer/9842756?hl=en
[register]: https://support.google.com/googleplay/android-developer/answer/6112435?hl=en
[required-info]: https://support.google.com/googleplay/android-developer/answer/13628312?hl=en
[target-api]: https://support.google.com/googleplay/android-developer/answer/11926878?hl=en
[testing]: https://support.google.com/googleplay/android-developer/answer/9845334?hl=en
[verify]: https://support.google.com/googleplay/android-developer/answer/10841920?hl=en
