import { expect, test } from "vitest";

import { useMobileApp } from "#src/fixtures.ts";
import { asIosAppDevice, type IosAppDevice } from "#src/ios/ios-app-device.ts";
import { signInFromLandingPage, waitForLandingPage, waitForRecents } from "#src/journeys.ts";
import {
  conversionStartsSince,
  expectSignInForStartFormUrl,
  waitForSharedConversions,
} from "#src/share-assertions.ts";

/**
 * Share intake through `audio.cup.app://share?url=…` links, as the Share Extension hands a share to
 * Cup, one test per app state. The component tests of `incoming-urls.ios.ts` cover what the web app
 * does with the link, such as repeat shares, Cup links and links without an HTTP(S) URL. Signed
 * out, each test opens the link in a Cup that is running or started by the link, checks that the
 * landing page's start form took the URL and asked to sign in, and that the share started no
 * conversion; signed in, that the share started a conversion of the URL, which Recents lists.
 */
const app = useMobileApp();

const SHARED_URL = "https://source.example.test/fixture";

test("a share fills the landing page's start form and asks to sign in", async () => {
  const device = await launchToLandingPage();

  await device.openUrl(shareLink(SHARED_URL));

  await expectSignInForStartFormUrl(await device.webView(), SHARED_URL);
  expect(conversionStartsSince(app.worker, 0)).toEqual([]);
});

test("a share that starts Cup fills the landing page's start form and asks to sign in", async () => {
  const device = await prepareColdStart();

  await device.openUrl(shareLink(SHARED_URL));

  await expectSignInForStartFormUrl(await device.webView(), SHARED_URL);
  // The web app asks for the auth configuration at startup, here from the test Worker.
  expect(app.worker.requests()).toContainEqual(
    expect.objectContaining({ method: "GET", path: "/api/auth/config" }),
  );
  expect(conversionStartsSince(app.worker, 0)).toEqual([]);
});

test("a signed-in share while Cup is running starts its conversion", async () => {
  const device = await signIn();

  const requestCount = app.worker.requests().length;
  await device.openUrl(shareLink(SHARED_URL));

  expect(
    await waitForSharedConversions(await device.webView(), app.worker, {
      requestCount,
      starts: 1,
      tracks: 2,
    }),
  ).toEqual([SHARED_URL]);
});

test("a signed-in share that starts Cup starts its conversion", async () => {
  const device = await signIn();
  // A share that starts Cup passes no launch arguments.
  await device.storeApiOrigin(app.apiOrigin);
  await device.terminate();

  const requestCount = app.worker.requests().length;
  await device.openUrl(shareLink(SHARED_URL));

  expect(
    await waitForSharedConversions(await device.webView(), app.worker, {
      requestCount,
      starts: 1,
      tracks: 2,
    }),
  ).toEqual([SHARED_URL]);
});

/** Launches Cup, signs in from the landing page and ends on Recents, which lists one conversion. */
async function signIn(): Promise<IosAppDevice> {
  const device = asIosAppDevice(app.device);
  await device.launch({ apiOrigin: app.apiOrigin });
  const webView = await device.webView();
  await signInFromLandingPage(device, webView);
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);
  return device;
}

/** Launches Cup with the launch arguments, which a URL that starts Cup would not pass. */
async function launchToLandingPage(): Promise<IosAppDevice> {
  const device = asIosAppDevice(app.device);
  await device.launch({ apiOrigin: app.apiOrigin });
  await waitForLandingPage(await device.webView());
  return device;
}

/**
 * Leaves Cup not running, as every test starts it, and stores the test Worker's origin, which a
 * link that starts Cup cannot pass as launch arguments.
 */
async function prepareColdStart(): Promise<IosAppDevice> {
  const device = asIosAppDevice(app.device);
  expect(await device.appState("cup")).toBe("not running");
  await device.storeApiOrigin(app.apiOrigin);
  return device;
}

/** The link the Share Extension opens for a shared URL. */
function shareLink(url: string): string {
  return `audio.cup.app://share?url=${encodeURIComponent(url)}`;
}
