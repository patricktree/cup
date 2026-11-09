import { expect, test } from "vitest";

import { asAndroidAppDevice } from "#src/android/android-app-device.ts";
import { useMobileApp } from "#src/fixtures.ts";
import { pathname, startSignInFromLandingPage } from "#src/journeys.ts";

/**
 * Drives Google's real sign-in on the account-less emulator, so it needs internet access and Google
 * Play services, and fails when Google changes that screen.
 */
const app = useMobileApp();

const GOOGLE_PLAY_SERVICES = "com.google.android.gms";
/** Google Play services' add-account screen, which loads Google's sign-in page. */
const ADD_ACCOUNT_ACTIVITY = `${GOOGLE_PLAY_SERVICES}/${GOOGLE_PLAY_SERVICES}.auth.uiflows.minutemaid.MinuteMaidActivity`;

test("cancelling Google's add-account screen returns to a usable landing page", async () => {
  const device = asAndroidAppDevice(app.device);
  await device.launch({ apiOrigin: app.apiOrigin, realGoogleSignIn: true });
  let webView = await device.webView();
  await startSignInFromLandingPage(webView);

  await webView.$("button=Continue with Google").click();
  // With no account on the device, Google's sign-in opens its add-account screen. It first shows
  // `GoogleSignInActivity`, which then starts the add-account flow on top of itself: a Back pressed
  // before that start cancels only the trampoline, and the add-account screen opens anyway. So wait
  // for the add-account screen itself, not for Google Play services' package.
  await expect
    .poll(() => device.focusedActivity(), { timeout: 30_000, interval: 500 })
    .toBe(ADD_ACCOUNT_ACTIVITY);
  // The add-account screen shows "Checking info…" while it loads Google's sign-in page. A Back
  // pressed then can close only the activities beneath it and leave the screen in front, so wait
  // for a button of the rendered page, such as SKIP on "Sign in with ease".
  await expect
    .poll(() => device.showsButton(GOOGLE_PLAY_SERVICES), { timeout: 30_000, interval: 500 })
    .toBe(true);
  await device.pressBack();
  await expect
    .poll(() => device.focusedPackage(), { timeout: 30_000, interval: 500 })
    .toBe("audio.cup.app");

  webView = await device.webView();
  expect(await pathname(webView)).toBe("/app/");
  // Usable for another attempt. On the 2026-11-09 run, Cup kept its state: the same page, the
  // filled start form and the open sign-in dialog, which showed the cancellation as an error. If
  // the WebView restarts instead, the start form asks to sign in again.
  const signIn = webView.$("button=Continue with Google");
  if (!(await signIn.isDisplayed())) {
    await startSignInFromLandingPage(webView);
  }
  expect(await signIn.isEnabled()).toBe(true);
});
