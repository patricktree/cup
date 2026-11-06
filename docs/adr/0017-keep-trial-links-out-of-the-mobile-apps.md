---
status: accepted
---

# Keep trial links out of the mobile apps

The Android and iOS apps claimed `https://cup.audio/app` links through Android App Links and iOS Universal Links, and the iOS Share Extension opened a shared trial link in the app. Cup has no links meant to open the app, and the only Cup links people pass around are trial links. A trial is for trying Cup without installing anything, and it was never released in the apps. Patrick decided on 2026-11-06 that the mobile apps intentionally don't support trial links, and [patricktree/cup#178](https://github.com/patricktree/cup/pull/178) implemented it.

## Decision

- **The apps claim no web links.** There are no App Links, Universal Links or domain association files. Tapping a link to `cup.audio`, such as a trial link, opens the browser.
- **Share intake ignores Cup links.** A shared URL on one of Cup's hostnames neither opens the app on a trial nor fills a conversion form, on Android or through the iOS Share Extension. Other shared URLs fill the conversion form as before.
- **The apps never open a trial.** The share handoff no longer reopens the last trial for a signed-out listener; it opens the landing page.

## Considered options

- **Keep App Links and Universal Links.** Rejected: trials belong in the browser, and the association files tied each release to a signing certificate fingerprint and an enrolled Apple team prefix.
- **Open a trial link shared into the app.** Rejected: it was the last way for a trial to reach the apps.
- **Treat a shared trial link like any other URL.** Rejected: it would put the trial credential into the conversion form, and a Cup page is nothing to convert.

## Consequences

- In the apps, a listener produces audiobooks only after signing in.
- Supporting trial links or other links in the apps later needs a new decision, a domain association file for each platform, and release signing set up for them again.
- [`share-plugin.android.test.ts`](../../apps/web-app/src/platform/share-plugin.android.test.ts) and [`incoming-urls.ios.test.ts`](../../apps/web-app/src/platform/incoming-urls.ios.test.ts) cover the ignored Cup links.
