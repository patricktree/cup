/**
 * Listener journeys inside the WebView that several specs share. Each takes the session switched
 * into the WebView, as `AppDevice.webView()` returns it.
 */

/** The source URL the test Worker's fake source preparation accepts. */
const SOURCE_URL = "https://source.example.test/fixture";

const SIGN_IN_TIMEOUT_MS = 60_000;

/**
 * From the signed-out landing page, starts a conversion of `SOURCE_URL` and signs in with "Continue
 * with Google", which the platform's sign-in fake answers. Ends on the new audiobook's page.
 */
export async function signInFromLandingPage(webView: WebdriverIO.Browser): Promise<void> {
  await startSignInFromLandingPage(webView);
  await webView.$("button=Continue with Google").click();
  await webView.waitUntil(async () => (await pathname(webView)).startsWith("/app/audiobooks/"), {
    timeout: SIGN_IN_TIMEOUT_MS,
    timeoutMsg: "Signing in did not open the new audiobook.",
  });
}

/** Fills the landing page's start form with `SOURCE_URL` and submits it, which asks to sign in. */
export async function startSignInFromLandingPage(webView: WebdriverIO.Browser): Promise<void> {
  const url = webView.$('input[type="url"]');
  await url.waitForDisplayed({ timeout: 30_000 });
  await url.setValue(SOURCE_URL);
  await webView.$("button=Listen").click();
  await webView.$("button=Continue with Google").waitForEnabled({ timeout: 30_000 });
}

/** Waits until Recents lists `count` tracks. */
export async function waitForRecents(webView: WebdriverIO.Browser, count: number): Promise<void> {
  await webView.waitUntil(
    async () =>
      (await pathname(webView)) === "/app/recent" &&
      (await webView.$$('ul[aria-label="Tracks"] > li').length) === count,
    { timeout: 30_000, timeoutMsg: `Recents did not list ${count} track(s).` },
  );
}

/** Waits for the signed-out landing page: its start form. */
export async function waitForLandingPage(webView: WebdriverIO.Browser): Promise<void> {
  await webView.$("button=Listen").waitForDisplayed({ timeout: 30_000 });
  await webView.waitUntil(async () => (await pathname(webView)) === "/app/", {
    timeout: 10_000,
    timeoutMsg: "The landing page is not at /app/.",
  });
}

export function pathname(webView: WebdriverIO.Browser): Promise<string> {
  return webView.execute(() => window.location.pathname);
}
