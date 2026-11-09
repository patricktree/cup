import { expect, test } from "vitest";

import { asAndroidAppDevice } from "#src/android/android-app-device.ts";
import { useMobileApp } from "#src/fixtures.ts";
import {
  pathname,
  signInFromLandingPage,
  waitForLandingPage,
  waitForRecents,
} from "#src/journeys.ts";

/**
 * Share intake through an explicit `ACTION_SEND` intent, as another app's Sharesheet sends it. Each
 * test checks the URL field of the form the share filled, and that the share started no
 * conversion.
 */
const app = useMobileApp();

const SHARED_URL = "https://source.example.test/fixture";
/** How long an ignored share is watched for a form opening anyway. */
const IGNORED_SHARE_OBSERVATION_MS = 3000;

test("a share while Cup is not running opens the Add dialog with the URL", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();
  await device.terminate();

  const requestCount = app.worker.requests().length;
  await device.share(SHARED_URL, { apiOrigin: app.apiOrigin });

  expect(await addDialogUrl(await device.webView())).toBe(SHARED_URL);
  expect(conversionStartsSince(requestCount)).toEqual([]);
});

test("a share while Cup is running opens the Add dialog with the URL", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  await device.share(SHARED_URL, { apiOrigin: app.apiOrigin });

  expect(await addDialogUrl(await device.webView())).toBe(SHARED_URL);
  expect(conversionStartsSince(requestCount)).toEqual([]);
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
  expect(conversionStartsSince(requestCount)).toEqual([]);
});

test("a URL with &, + and a #fragment arrives unchanged", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();
  const url = "https://source.example.test/fixture?topic=a+b&page=2#part-2";

  const requestCount = app.worker.requests().length;
  await device.share(url, { apiOrigin: app.apiOrigin });

  expect(await addDialogUrl(await device.webView())).toBe(url);
  expect(conversionStartsSince(requestCount)).toEqual([]);
});

test("a URL inside shared text is picked out", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  await device.share(`The fixture's title — ${SHARED_URL}`, { apiOrigin: app.apiOrigin });

  expect(await addDialogUrl(await device.webView())).toBe(SHARED_URL);
  expect(conversionStartsSince(requestCount)).toEqual([]);
});

test("shared text without a URL is ignored", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  await device.share("Just some words, no link", { apiOrigin: app.apiOrigin });

  await expectToStayOnRecents(await device.webView());
  expect(conversionStartsSince(requestCount)).toEqual([]);
});

test("a shared cup.audio link is ignored", async () => {
  const device = asAndroidAppDevice(app.device);
  await signIn();

  const requestCount = app.worker.requests().length;
  // Trial links stay out of the mobile apps (ADR 0017), and so does any other Cup link.
  await device.share("https://cup.audio/trials/fixture-grant", { apiOrigin: app.apiOrigin });

  await expectToStayOnRecents(await device.webView());
  expect(conversionStartsSince(requestCount)).toEqual([]);
});

test("a share while signed out fills the landing page's start form", async () => {
  const device = asAndroidAppDevice(app.device);
  // Each test starts signed out, with Cup not running.

  await device.share(SHARED_URL, { apiOrigin: app.apiOrigin });
  const webView = await device.webView();

  await waitForLandingPage(webView);
  await expect
    .poll(() => webView.$('input[type="url"]').getValue(), { timeout: 10_000, interval: 250 })
    .toBe(SHARED_URL);
  expect(conversionStartsSince(0)).toEqual([]);
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

/** Waits for the Add dialog and returns its URL field's value once it is filled. */
async function addDialogUrl(webView: WebdriverIO.Browser): Promise<string> {
  const url = webView.$('[role="dialog"] input[type="url"]');
  await url.waitForDisplayed({ timeout: 30_000 });
  await webView.waitUntil(async () => (await url.getValue()) !== "", {
    timeout: 10_000,
    timeoutMsg: "The Add dialog's URL field stayed empty.",
  });
  return url.getValue();
}

/**
 * Checks for a while that Cup keeps showing Recents with no form open. The intent has been
 * delivered when `share` returns, and a share that is taken opens the Add dialog within a second.
 */
async function expectToStayOnRecents(webView: WebdriverIO.Browser): Promise<void> {
  const deadline = performance.now() + IGNORED_SHARE_OBSERVATION_MS;
  while (performance.now() < deadline) {
    expect(await pathname(webView)).toBe("/app/recent");
    expect(await webView.$('[role="dialog"]').isExisting()).toBe(false);
    expect(await webView.$('input[type="url"]').isExisting()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await waitForRecents(webView, 1);
}

/** The requests that started a conversion, on an account or a trial, after the first `count`. */
function conversionStartsSince(count: number): string[] {
  return app.worker
    .requests()
    .slice(count)
    .filter(({ method, path }) => method === "POST" && /\/conversions(?:\?|$)/u.test(path))
    .map(({ method, path }) => `${method} ${path}`);
}
