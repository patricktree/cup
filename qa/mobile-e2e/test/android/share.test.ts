import { expect, test } from "vitest";

import { asAndroidAppDevice } from "#src/android/android-app-device.ts";
import { useMobileApp } from "#src/fixtures.ts";
import { signInFromLandingPage, waitForRecents } from "#src/journeys.ts";
import {
  conversionStartsSince,
  expectSignInForStartFormUrl,
  waitForSharedConversions,
} from "#src/share-assertions.ts";

/**
 * Share intake through an explicit `ACTION_SEND` intent, as another app's Sharesheet sends it, one
 * test per app state. The component tests of `share-plugin.android.ts` cover what the web app does
 * with the shared text, such as repeat shares, text without a URL and Cup links. Signed in, each
 * test checks that the share started a conversion of the shared URL exactly and Recents lists it
 * next to the sign-in's track; signed out, that it filled the start form and asked to sign in.
 */
const app = useMobileApp();

const SHARED_URL = "https://source.example.test/fixture";

test("a share while Cup is not running starts its conversion", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();
  // Not a plain force-stop: one with Cup in front right after the sign-in can lose the session.
  await device.leaveAndTerminate();
  // `&`, `+` and the fragment must arrive unchanged through the intent `adb` sends.
  const url = "https://source.example.test/fixture?topic=a+b&page=2#part-2";

  const requestCount = app.worker.requests().length;
  await device.share(url, { apiOrigin: app.apiOrigin });

  expect(
    await waitForSharedConversions(await device.webView(), app.worker, {
      requestCount,
      starts: 1,
      tracks: 2,
    }),
  ).toEqual([url]);
});

test("a share while Cup is running starts a conversion of the URL in the shared text", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  await device.share(`The fixture's title — ${SHARED_URL}`, { apiOrigin: app.apiOrigin });

  expect(
    await waitForSharedConversions(await device.webView(), app.worker, {
      requestCount,
      starts: 1,
      tracks: 2,
    }),
  ).toEqual([SHARED_URL]);
});

test("a share while signed out fills the landing page's start form and asks to sign in", async () => {
  const device = asAndroidAppDevice(app.device);
  // Each test starts signed out, with Cup not running.

  await device.share(SHARED_URL, { apiOrigin: app.apiOrigin });

  await expectSignInForStartFormUrl(await device.webView(), SHARED_URL);
  // The web app asks for the auth configuration at startup, here from the test Worker.
  expect(app.worker.requests()).toContainEqual(
    expect.objectContaining({ method: "GET", path: "/api/auth/config" }),
  );
  expect(conversionStartsSince(app.worker, 0)).toEqual([]);
});

/** Signs in from the landing page and ends on Recents, which lists the sign-in's conversion. */
async function signIn(): Promise<WebdriverIO.Browser> {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  const webView = await app.device.webView();
  await signInFromLandingPage(app.device, webView);
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);
  return webView;
}
