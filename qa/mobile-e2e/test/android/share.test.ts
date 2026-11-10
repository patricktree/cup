import { expect, test } from "vitest";

import { asAndroidAppDevice } from "#src/android/android-app-device.ts";
import { useMobileApp } from "#src/fixtures.ts";
import { signInFromLandingPage, waitForRecents } from "#src/journeys.ts";
import {
  addDialogUrl,
  conversionStartsSince,
  expectShareIgnored,
  expectStartFormUrl,
} from "#src/share-assertions.ts";

/**
 * Share intake through an explicit `ACTION_SEND` intent, as another app's Sharesheet sends it. Each
 * test checks the URL field of the form the share filled, and that the share started no
 * conversion.
 */
const app = useMobileApp();

const SHARED_URL = "https://source.example.test/fixture";

test("a share while Cup is not running opens the Add dialog with the URL", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();
  // Not a plain force-stop: one with Cup in front right after the sign-in can lose the session.
  await device.leaveAndTerminate();

  const requestCount = app.worker.requests().length;
  await device.share(SHARED_URL, { apiOrigin: app.apiOrigin });

  expect(await addDialogUrl(await device.webView())).toBe(SHARED_URL);
  expect(conversionStartsSince(app.worker, requestCount)).toEqual([]);
});

test("a share while Cup is running opens the Add dialog with the URL", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  await device.share(SHARED_URL, { apiOrigin: app.apiOrigin });

  expect(await addDialogUrl(await device.webView())).toBe(SHARED_URL);
  expect(conversionStartsSince(app.worker, requestCount)).toEqual([]);
});

test("a second share replaces the first one's URL", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();
  const secondUrl = "https://source.example.test/second";

  const requestCount = app.worker.requests().length;
  await device.share(SHARED_URL, { apiOrigin: app.apiOrigin });
  const webView = await device.webView();
  expect(await addDialogUrl(webView)).toBe(SHARED_URL);
  await device.share(secondUrl, { apiOrigin: app.apiOrigin });

  await expect
    .poll(async () => addDialogUrl(await device.webView()), { timeout: 30_000, interval: 500 })
    .toBe(secondUrl);
  expect(conversionStartsSince(app.worker, requestCount)).toEqual([]);
});

test("a URL with &, + and a #fragment arrives unchanged", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();
  const url = "https://source.example.test/fixture?topic=a+b&page=2#part-2";

  const requestCount = app.worker.requests().length;
  await device.share(url, { apiOrigin: app.apiOrigin });

  expect(await addDialogUrl(await device.webView())).toBe(url);
  expect(conversionStartsSince(app.worker, requestCount)).toEqual([]);
});

test("a URL inside shared text is picked out", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  await device.share(`The fixture's title — ${SHARED_URL}`, { apiOrigin: app.apiOrigin });

  expect(await addDialogUrl(await device.webView())).toBe(SHARED_URL);
  expect(conversionStartsSince(app.worker, requestCount)).toEqual([]);
});

test("shared text without a URL is ignored", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  await device.share("Just some words, no link", { apiOrigin: app.apiOrigin });

  await expectShareIgnored(await device.webView(), "recents");
  expect(conversionStartsSince(app.worker, requestCount)).toEqual([]);
});

test("a shared cup.audio link is ignored", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  // Trial links stay out of the mobile apps (ADR 0017), and so does any other Cup link.
  await device.share("https://cup.audio/trials/fixture-grant", { apiOrigin: app.apiOrigin });

  await expectShareIgnored(await device.webView(), "recents");
  expect(conversionStartsSince(app.worker, requestCount)).toEqual([]);
});

test("a share while signed out fills the landing page's start form", async () => {
  const device = asAndroidAppDevice(app.device);
  // Each test starts signed out, with Cup not running.

  await device.share(SHARED_URL, { apiOrigin: app.apiOrigin });

  await expectStartFormUrl(await device.webView(), SHARED_URL);
  expect(conversionStartsSince(app.worker, 0)).toEqual([]);
});

/** Signs in from the landing page and ends on Recents, which lists the sign-in's conversion. */
async function signIn(): Promise<WebdriverIO.Browser> {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  const webView = await app.device.webView();
  await signInFromLandingPage(webView);
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);
  return webView;
}
