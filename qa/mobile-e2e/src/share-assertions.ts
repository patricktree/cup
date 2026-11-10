/**
 * Assertions the share specs of every platform share. A taken share fills a form's URL field with
 * the shared URL exactly and starts no conversion; an ignored share leaves Cup on its screen with
 * no form filled.
 */
import { expect } from "vitest";

import type { TestWorker } from "@cup/test-worker";

import { pathname, waitForLandingPage, waitForRecents } from "#src/journeys.ts";

/** How long an ignored share is watched for a form opening or filling anyway. */
const IGNORED_SHARE_OBSERVATION_MS = 3000;

/** The screens an ignored share is checked to leave Cup on. */
export type ShareScreen = "recents" | "landing page";

/** Waits for the Add dialog and returns its URL field's value once it is filled. */
export async function addDialogUrl(webView: WebdriverIO.Browser): Promise<string> {
  const url = webView.$('[role="dialog"] input[type="url"]');
  await url.waitForDisplayed({ timeout: 30_000 });
  await webView.waitUntil(async () => (await url.getValue()) !== "", {
    timeout: 10_000,
    timeoutMsg: "The Add dialog's URL field stayed empty.",
  });
  return url.getValue();
}

/** Waits for the landing page and until its start form's URL field is `url`. */
export async function expectStartFormUrl(webView: WebdriverIO.Browser, url: string): Promise<void> {
  await waitForLandingPage(webView);
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

/** The requests that started a conversion, on an account or a trial, after the first `count`. */
export function conversionStartsSince(worker: TestWorker, count: number): string[] {
  return worker
    .requests()
    .slice(count)
    .filter(({ method, path }) => method === "POST" && /\/conversions(?:\?|$)/u.test(path))
    .map(({ method, path }) => `${method} ${path}`);
}
