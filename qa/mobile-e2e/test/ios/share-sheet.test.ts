import { afterEach, beforeEach, expect, test } from "vitest";

import { useMobileApp } from "#src/fixtures.ts";
import { asIosAppDevice } from "#src/ios/ios-app-device.ts";
import { startSharedPage, type SharedPage } from "#src/ios/shared-page.ts";
import { signInFromLandingPage, waitForRecents } from "#src/journeys.ts";
import {
  conversionStartsSince,
  expectSignInForStartFormUrl,
  waitForSharedConversions,
} from "#src/share-assertions.ts";

/**
 * Sharing a page from Safari through the real Share Sheet: **Cup** in the app row, and nothing
 * more. The `CupShare` extension reads the page's URL and hands it to Cup as an
 * `audio.cup.app://share` link on its own. These tests depend on Safari's system UI and fail when
 * an iOS update changes it. Each share starts Cup; a share that reaches a running Cup takes the
 * same handoff, which the link alone covers in `share.test.ts`.
 */
const app = useMobileApp();

let page: SharedPage;

beforeEach(async () => {
  page = await startSharedPage();
});

afterEach(async () => {
  await page.close();
});

test("a signed-in share from Safari starts Cup and the conversion of the page", async () => {
  const device = asIosAppDevice(app.device);
  await device.launch({ apiOrigin: app.apiOrigin });
  const webView = await device.webView();
  await signInFromLandingPage(device, webView);
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);
  // A share that starts Cup passes no launch arguments.
  await device.storeApiOrigin(app.apiOrigin);
  await device.terminate();
  const sharedUrl = page.url("/signed-in");
  const requestCount = app.worker.requests().length;

  await device.shareFromSafari(sharedUrl);

  expect(
    await waitForSharedConversions(await device.webView(), app.worker, {
      requestCount,
      starts: 1,
      tracks: 2,
    }),
  ).toEqual([sharedUrl]);
});

test("a signed-out share from Safari starts Cup, fills the landing page's start form and asks to sign in", async () => {
  const device = asIosAppDevice(app.device);
  // `&`, `+` and the fragment must arrive unchanged.
  const sharedUrl = page.url("/article?a=1&b=2+3#fragment");
  // A share that starts Cup passes no launch arguments.
  await device.storeApiOrigin(app.apiOrigin);

  await device.shareFromSafari(sharedUrl);

  await expectSignInForStartFormUrl(await device.webView(), sharedUrl);
  // The web app asks for the auth configuration at startup, here from the test Worker.
  expect(app.worker.requests()).toContainEqual(
    expect.objectContaining({ method: "GET", path: "/api/auth/config" }),
  );
  expect(conversionStartsSince(app.worker, 0)).toEqual([]);
});
