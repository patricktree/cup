import { expect, test } from "vitest";

import { useMobileApp } from "#src/fixtures.ts";
import {
  pathname,
  signInFromLandingPage,
  waitForLandingPage,
  waitForRecents,
} from "#src/journeys.ts";

/**
 * Sign-in through the platform's adapter, including the fresh sign-in before account deletion,
 * Secure Storage and the Worker's token check, against the test's fake auth provider:
 *
 * - On Android: the nonce and `signInWithIdToken`, with the debug build's fake of the Google sign-in
 *   plugin asking the fake auth provider for an ID token.
 * - On iOS: Supabase's OAuth flow with PKCE in the real `ASWebAuthenticationSession` of the
 *   `WebAuthentication` plugin, which the fake auth provider sends straight to Cup's callback URL.
 */
const app = useMobileApp();

test("signs in with Google and sees Recents loaded from the test Worker", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  const webView = await app.device.webView();

  await signInFromLandingPage(app.device, webView);
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

test("stays signed in after Cup is stopped and relaunched", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  await signInFromLandingPage(app.device, await app.device.webView());

  await app.device.relaunch();
  const webView = await app.device.webView();

  // Signed in, the landing page opens Recents instead of asking to sign in.
  await waitForRecents(webView, 1);
  expect(await webView.$("button=Continue with Google").isExisting()).toBe(false);
});

test("stays signed out after signing out and relaunching", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  let webView = await app.device.webView();
  await signInFromLandingPage(app.device, webView);
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);

  // Scheduling the account's deletion is how a listener signs out; it signs in afresh first.
  await webView.$('a[aria-label="Account"]').click();
  await webView.$("button=Delete account…").click();
  await app.device.continueGoogleSignIn();
  const scheduleDeletion = webView.$("button=Schedule deletion");
  await scheduleDeletion.waitForEnabled({ timeout: 30_000 });
  await scheduleDeletion.click();
  await waitForLandingPage(webView);

  await app.device.relaunch();
  webView = await app.device.webView();

  await waitForLandingPage(webView);
  expect(await pathname(webView)).toBe("/app/");
});
