import { afterEach, beforeEach, expect, test } from "vitest";

import { useMobileApp } from "#src/fixtures.ts";
import { asIosAppDevice } from "#src/ios/ios-app-device.ts";
import { startSharedPage, type SharedPage } from "#src/ios/shared-page.ts";
import { waitForLandingPage } from "#src/journeys.ts";
import { conversionStartsSince, expectStartFormUrl } from "#src/share-assertions.ts";

/**
 * Sharing a page from Safari through the real Share Sheet: **Cup** in the app row, then **Open in
 * Cup** or **Cancel** in the `CupShare` extension, which hands the URL to Cup as an
 * `audio.cup.app://share` link. These tests depend on Safari's system UI and fail when an iOS
 * update changes it. Signing in does not work on iOS yet, so Cup runs signed out and a share fills
 * the landing page's start form.
 */
const app = useMobileApp();

/** How long a cancelled share is watched for Cup opening anyway. */
const CANCEL_OBSERVATION_MS = 3000;

let page: SharedPage;

beforeEach(async () => {
  page = await startSharedPage();
});

afterEach(async () => {
  await page.close();
});

test("a share from Safari starts Cup and fills the landing page's start form", async () => {
  const device = asIosAppDevice(app.device);
  // `&`, `+` and the fragment must arrive unchanged.
  const sharedUrl = page.url("/article?a=1&b=2+3#fragment");
  // A share that starts Cup passes no launch arguments.
  await device.storeApiOrigin(app.apiOrigin);

  await device.shareFromSafari(sharedUrl, "open in cup");

  await expectStartFormUrl(await device.webView(), sharedUrl);
  // The web app asks for the auth configuration at startup, here from the test Worker.
  expect(app.worker.requests()).toContainEqual(
    expect.objectContaining({ method: "GET", path: "/api/auth/config" }),
  );
  expect(conversionStartsSince(app.worker, 0)).toEqual([]);
});

test("a share from Safari fills the start form of a running Cup", async () => {
  const device = asIosAppDevice(app.device);
  const sharedUrl = page.url("/running?x=%20y&z=1");
  await device.launch({ apiOrigin: app.apiOrigin });
  await waitForLandingPage(await device.webView());

  await device.shareFromSafari(sharedUrl, "open in cup");

  await expectStartFormUrl(await device.webView(), sharedUrl);
  expect(conversionStartsSince(app.worker, 0)).toEqual([]);
});

test("cancelling the share leaves Safari in front and Cup closed", async () => {
  const device = asIosAppDevice(app.device);
  await device.storeApiOrigin(app.apiOrigin);
  const requestCount = app.worker.requests().length;

  await device.shareFromSafari(page.url("/cancelled"), "cancel");

  // A Cup that opens does so within a second of the tap; watch for a while.
  const deadline = performance.now() + CANCEL_OBSERVATION_MS;
  while (performance.now() < deadline) {
    expect(await device.appState("safari")).toBe("foreground");
    expect(await device.appState("cup")).toBe("not running");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(app.worker.requests().slice(requestCount)).toEqual([]);
});
