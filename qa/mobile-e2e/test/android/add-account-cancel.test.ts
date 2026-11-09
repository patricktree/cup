import { expect, test } from "vitest";

import { asAndroidAppDevice } from "#src/android/android-app-device.ts";
import { useMobileApp } from "#src/fixtures.ts";
import { pathname, startSignInFromLandingPage } from "#src/journeys.ts";

/**
 * Drives Google's real sign-in on the account-less emulator, so it needs internet access and Google
 * Play services, and fails when Google changes that screen.
 */
const app = useMobileApp();

test("cancelling Google's add-account screen returns to a usable landing page", async () => {
  const device = asAndroidAppDevice(app.device);
  await device.launch({ apiOrigin: app.apiOrigin, realGoogleSignIn: true });
  let webView = await device.webView();
  await startSignInFromLandingPage(webView);

  await webView.$("button=Continue with Google").click();
  // With no account on the device, Google's sign-in opens its add-account screen.
  await expect
    .poll(() => device.focusedPackage(), { timeout: 30_000, interval: 500 })
    .toBe("com.google.android.gms");
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
