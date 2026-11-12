import { expect, test } from "vitest";

import { useMobileApp } from "#src/fixtures.ts";
import { asIosAppDevice } from "#src/ios/ios-app-device.ts";
import { signInFromLandingPage, waitForRecents } from "#src/journeys.ts";

/**
 * Cup's WebView reaches under the status bar, so the web app keeps its content out of the top safe
 * area and paints the page's background behind the status bar.
 */
const app = useMobileApp();

const BACK_LINK = '-ios predicate string:type == "XCUIElementTypeLink" AND label == "Back"';

/**
 * The audiobook page's sticky header holds the Back link at the very top of the page, at rest and
 * stuck after scrolling. Its position is the native one in screen points, which the WebView's own
 * coordinates would not reveal.
 */
test("the audiobook page's Back link stays below the status bar, and a backdrop covers it on Recents", async () => {
  const device = asIosAppDevice(app.device);
  await device.launch({ apiOrigin: app.apiOrigin });
  // One Appium session, switched between the WebView and the native context.
  const session = await device.webView();
  await signInFromLandingPage(device, session);
  await session.$('a[aria-label="Back"]').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: "The audiobook page shows no Back link.",
  });

  const statusBarHeight = await device.statusBarHeight();

  expect((await session.$(BACK_LINK).getLocation()).y).toBeGreaterThanOrEqual(statusBarHeight);

  // Scrolled, the header is stuck to the top of the screen. The page scrolls only within its height:
  // past its end, WebKit bounces the whole page back, header included.
  await device.webView();
  const scrollTarget = await session.execute(() => {
    const target = Math.min(400, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, target);
    return target;
  });
  expect(scrollTarget).toBeGreaterThan(0);
  await session.waitUntil(
    async () => (await session.execute(() => window.scrollY)) === scrollTarget,
    { timeout: 10_000, timeoutMsg: "The audiobook page did not scroll." },
  );
  await session.switchContext("NATIVE_APP");

  expect((await session.$(BACK_LINK).getLocation()).y).toBeGreaterThanOrEqual(statusBarHeight);

  // Recents has no sticky header, so its list scrolls up to the status bar, where a fixed backdrop
  // in the page's background covers it. WebKit hit-tests nothing under the status bar, so the test
  // checks that the backdrop spans the top safe area rather than what is drawn there.
  await device.webView();
  await session.$('a[aria-label="Back"]').click();
  await waitForRecents(session, 1);

  const geometry = await session.execute(() => {
    const probe = document.createElement("div");
    probe.style.height = "env(safe-area-inset-top, 0)";
    document.body.append(probe);
    const safeAreaTop = probe.getBoundingClientRect().height;
    probe.remove();

    const backdrop = document.querySelector("[data-status-bar-backdrop]");
    const rect = backdrop?.getBoundingClientRect();
    return {
      safeAreaTop,
      viewportWidth: window.innerWidth,
      backdrop: backdrop &&
        rect && {
          position: getComputedStyle(backdrop).position,
          top: rect.top,
          height: rect.height,
          width: rect.width,
        },
    };
  });

  expect(geometry.safeAreaTop).toBeGreaterThan(0);
  expect(geometry.backdrop).toEqual({
    position: "fixed",
    top: 0,
    height: geometry.safeAreaTop,
    width: geometry.viewportWidth,
  });
});
