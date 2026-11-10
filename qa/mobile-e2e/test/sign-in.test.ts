import { expect, test } from "vitest";

import type { RecordedRequest } from "@cup/test-worker";

import { useMobileApp } from "#src/fixtures.ts";
import {
  pathname,
  signInFromHomeLink,
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

test("signs in from the home page's sign-in link and lands on Recents loaded from the test Worker", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  const webView = await app.device.webView();

  await signInFromHomeLink(app.device, webView);

  // A new account has no tracks yet, so Recents invites it to add the first one.
  await webView.$("a=Add your first track").waitForDisplayed({ timeout: 30_000 });
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

test("refreshes the session when Cup comes back from the background after its access token expired", async () => {
  app.authProvider.setAccessTokenLifetime(ACCESS_TOKEN_LIFETIME_SECONDS);
  await app.device.launch({ apiOrigin: app.apiOrigin });
  let webView = await app.device.webView();
  await signInFromLandingPage(app.device, webView);
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);
  const tokenBeforeBackground = lastConversionsAuthorization();

  await app.device.background();
  await new Promise((resolve) => setTimeout(resolve, (ACCESS_TOKEN_LIFETIME_SECONDS + 1) * 1_000));
  const refreshesInBackground = app.authProvider.refreshes();
  await app.device.bringToForeground();
  webView = await app.device.webView();

  // Coming to the foreground refreshes at once, sooner than the 30-second refresh tick would.
  await expect
    .poll(() => app.authProvider.refreshes(), { timeout: 10_000, interval: 250 })
    .toBeGreaterThan(refreshesInBackground);
  // Leaving Recents for the track and coming back loads Recents from the Worker again.
  const requestsBeforeReturning = app.worker.requests().length;
  await webView.$('ul[aria-label="Tracks"] a').click();
  await webView.waitUntil(async () => (await pathname(webView)).startsWith("/app/audiobooks/"), {
    timeout: 30_000,
    timeoutMsg: "The track did not open.",
  });
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);
  await expect
    .poll(() => app.worker.requests().slice(requestsBeforeReturning).some(isConversionsRequest), {
      timeout: 10_000,
      interval: 250,
    })
    .toBe(true);
  const tokenAfterForeground = lastConversionsAuthorization();
  expect(tokenAfterForeground).toMatch(/^Bearer \S+$/);
  expect(tokenAfterForeground).not.toBe(tokenBeforeBackground);
  // The Worker, which accepts only an unexpired token, refused none of Cup's requests.
  expect(app.worker.logs.filter((line) => line.includes("401 Unauthorized"))).toEqual([]);
});

/** Short enough that a test outlives an access token. */
const ACCESS_TOKEN_LIFETIME_SECONDS = 5;

/** The bearer token of the latest request for Recents' tracks the Worker received. */
function lastConversionsAuthorization(): string | undefined {
  return app.worker.requests().findLast(isConversionsRequest)?.headers["authorization"];
}

function isConversionsRequest(request: RecordedRequest): boolean {
  return request.method === "GET" && request.path === "/api/account/conversions";
}

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
