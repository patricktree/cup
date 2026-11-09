import { expect, test } from "vitest";

import { useMobileApp } from "#src/fixtures.ts";
import {
  pathname,
  signInFromLandingPage,
  waitForLandingPage,
  waitForRecents,
} from "#src/journeys.ts";

/**
 * Sign-in through the Android adapter (nonce, `signInWithIdToken`, the fresh sign-in before account
 * deletion), Secure Storage and the Worker's token check, with the debug build's fake of the Google
 * sign-in plugin answering against the fake auth provider.
 */
const app = useMobileApp();

test("signs in with Google and sees Recents loaded from the test Worker", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  const webView = await app.device.webView();

  await signInFromLandingPage(webView);
  await webView.$('a[aria-label="Back"]').click();

  await waitForRecents(webView, 1);
  expect(app.worker.requests()).toContainEqual(
    expect.objectContaining({
      method: "GET",
      path: "/api/account/conversions",
      headers: expect.objectContaining({ authorization: expect.stringMatching(/^Bearer \S+$/) }),
    }),
  );
});

test("stays signed in after Cup is force-stopped and relaunched", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  await signInFromLandingPage(await app.device.webView());

  await app.device.relaunch();
  const webView = await app.device.webView();

  // Signed in, the landing page opens Recents instead of asking to sign in.
  await waitForRecents(webView, 1);
  expect(await webView.$("button=Continue with Google").isExisting()).toBe(false);
});

test("stays signed out after signing out and relaunching", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  let webView = await app.device.webView();
  await signInFromLandingPage(webView);
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);

  // Scheduling the account's deletion is how a listener signs out; it signs in afresh first.
  await webView.$('a[aria-label="Account"]').click();
  await webView.$("button=Delete account…").click();
  const scheduleDeletion = webView.$("button=Schedule deletion");
  await scheduleDeletion.waitForEnabled({ timeout: 30_000 });
  await scheduleDeletion.click();
  await waitForLandingPage(webView);

  await app.device.relaunch();
  webView = await app.device.webView();

  await waitForLandingPage(webView);
  expect(await pathname(webView)).toBe("/app/");
});
