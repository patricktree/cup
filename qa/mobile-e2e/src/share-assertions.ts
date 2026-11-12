/**
 * Assertions the share specs of every platform share. A share taken while signed in starts a
 * conversion of the shared URL exactly; one taken while signed out fills the landing page's start
 * form with it and asks to sign in, starting no conversion. An ignored share leaves Cup on its
 * screen with no form filled.
 */
import { expect } from "vitest";

import type { TestWorker } from "@cup/test-worker";

import { pathname, waitForLandingPage, waitForRecents } from "#src/journeys.ts";

/** How long a taken share has to reach the Worker as a conversion start. */
const CONVERSION_START_TIMEOUT_MS = 30_000;

/** How long an ignored share is watched for a form opening or filling anyway. */
const IGNORED_SHARE_OBSERVATION_MS = 3000;

/** The screens an ignored share is checked to leave Cup on. */
export type ShareScreen = "recents" | "landing page";

/**
 * Waits until `starts` conversions started after the first `requestCount` requests and the Add
 * dialog has closed over Recents, which then lists `tracks` tracks. Returns the started source URLs
 * in order.
 */
export async function waitForSharedConversions(
  webView: WebdriverIO.Browser,
  worker: TestWorker,
  { requestCount, starts, tracks }: { requestCount: number; starts: number; tracks: number },
): Promise<string[]> {
  await webView.waitUntil(() => conversionStartsSince(worker, requestCount).length >= starts, {
    timeout: CONVERSION_START_TIMEOUT_MS,
    timeoutMsg: `The shares did not start ${starts} conversion(s).`,
  });
  // The Add dialog closes once its start succeeded.
  await webView.waitUntil(async () => !(await webView.$('[role="dialog"]').isExisting()), {
    timeout: 10_000,
    timeoutMsg: "The Add dialog stayed open after its start.",
  });
  await waitForRecents(webView, tracks);
  return conversionStartsSince(worker, requestCount);
}

/**
 * Waits until the landing page's start form holds `url` exactly and the sign-in dialog its
 * submission opens asks to sign in.
 */
export async function expectSignInForStartFormUrl(
  webView: WebdriverIO.Browser,
  url: string,
): Promise<void> {
  await webView.$("button=Continue with Google").waitForDisplayed({ timeout: 30_000 });
  expect(await pathname(webView)).toBe("/app/");
  await expect
    .poll(() => webView.$('input[type="url"]').getValue(), { timeout: 10_000, interval: 250 })
    .toBe(url);
}

/**
 * Checks for a while that Cup keeps showing `screen` with no form open or filled. A share that is
 * taken fills a form within a second of reaching Cup.
 */
export async function expectShareIgnored(
  webView: WebdriverIO.Browser,
  screen: ShareScreen,
): Promise<void> {
  const deadline = performance.now() + IGNORED_SHARE_OBSERVATION_MS;
  while (performance.now() < deadline) {
    expect(await webView.$('[role="dialog"]').isExisting()).toBe(false);
    if (screen === "recents") {
      expect(await pathname(webView)).toBe("/app/recent");
      expect(await webView.$('input[type="url"]').isExisting()).toBe(false);
    } else {
      expect(await pathname(webView)).toBe("/app/");
      expect(await webView.$('input[type="url"]').getValue()).toBe("");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (screen === "recents") {
    await waitForRecents(webView, 1);
  } else {
    await waitForLandingPage(webView);
  }
}

/**
 * The source URLs of the requests that started a conversion, on an account or a trial, after the
 * first `count`, in order.
 */
export function conversionStartsSince(worker: TestWorker, count: number): string[] {
  return worker
    .requests()
    .slice(count)
    .filter(({ method, path }) => method === "POST" && /\/conversions(?:\?|$)/u.test(path))
    .map(({ body }) => readSourceUrl(body));
}

function readSourceUrl(body: string | undefined): string {
  const parsed: unknown = JSON.parse(body ?? "null");
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("sourceUrl" in parsed) ||
    typeof parsed.sourceUrl !== "string"
  ) {
    throw new TypeError(`A conversion start carried no source URL: ${body}`);
  }
  return parsed.sourceUrl;
}
