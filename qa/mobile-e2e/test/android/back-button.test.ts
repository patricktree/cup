import { expect, test } from "vitest";

import { asAndroidAppDevice, type AndroidAppDevice } from "#src/android/android-app-device.ts";
import { useMobileApp } from "#src/fixtures.ts";
import { pathname, signInFromLandingPage, waitForRecents } from "#src/journeys.ts";

/** The system back button, which the web app takes over from Android through Capacitor. */
const app = useMobileApp();

test("Back from the Add dialog and from a track returns to Recents", async () => {
  const device = asAndroidAppDevice(app.device);
  const webView = await openRecentsAsFirstScreen(device);

  await webView.$('nav[aria-label="Tabs"]').$("a*=Add").click();
  const addDialog = webView.$('[role="dialog"]');
  await addDialog.waitForDisplayed({ timeout: 30_000 });
  // The dialog focuses its URL field, which opens the on-screen keyboard, and Android's Back closes
  // an open keyboard instead of reaching Cup. Leave the field first, as tapping outside it does.
  // The keyboard can appear seconds after the field got focus, such as the first time after the
  // emulator booted, and then still shows after the field is left; wait for it to show and close.
  await device.waitForKeyboard("shown");
  await webView.execute(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await device.waitForKeyboard("hidden");
  await device.pressBack();
  await addDialog.waitForExist({ reverse: true, timeout: 10_000 });
  await waitForRecents(webView, 1);

  await webView.$('ul[aria-label="Tracks"] > li a').click();
  await webView.waitUntil(async () => (await pathname(webView)).startsWith("/app/audiobooks/"), {
    timeout: 30_000,
    timeoutMsg: "The track's page did not open.",
  });
  await device.pressBack();
  await waitForRecents(webView, 1);
  expect(await device.appState()).toBe("foreground");
});

test("Back on the first screen puts Cup in the background without finishing it", async () => {
  const device = asAndroidAppDevice(app.device);
  let webView = await openRecentsAsFirstScreen(device);
  // A finished activity takes its page with it, and so does this mark.
  await webView.execute(() => Reflect.set(window, "cupBackButtonMark", true));

  await device.pressBack();

  await expect.poll(() => device.appState(), { timeout: 10_000, interval: 250 }).toBe("background");
  await device.bringToForeground();
  webView = await device.webView();
  await waitForRecents(webView, 1);
  expect(await webView.execute(() => Reflect.get(window, "cupBackButtonMark"))).toBe(true);
});

/** Signs in, then relaunches Cup, so Recents is the first screen of a fresh history. */
async function openRecentsAsFirstScreen(device: AndroidAppDevice): Promise<WebdriverIO.Browser> {
  await device.launch({ apiOrigin: app.apiOrigin });
  await signInFromLandingPage(await device.webView());
  await device.relaunch();
  const webView = await device.webView();
  await waitForRecents(webView, 1);
  return webView;
}
