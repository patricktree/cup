import type { Page } from "@playwright/test";

import {
  readLoadingStateRecord,
  recordLoadingStates,
} from "@cup/web-app/test-utils/loading-state-recorder";

import { expect, test } from "#test-e2e/fixtures.ts";
import { readAccessToken, waitForAudiobook } from "#test-e2e/journey.ts";
import { waitForGeneratedAudio } from "#test-e2e/synthesis.ts";

const SOURCE_URL = "https://source.example.test/fixture";
const HISTORY_PATH = "/api/account/conversions";

/*
 * The UI gallery guards each rule of the loading model in the development build under Strict Mode.
 * This journey guards the production build against the real Worker, where React mounts each screen
 * once.
 */
test("Recents and a track opened again show their cached content while each is requested again", async ({
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  const conversionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!conversionId) {
    throw new Error("Conversion missing");
  }
  const audiobookPath = `/api/audiobooks/${conversionId}`;
  // A ready track: Recents then stops polling its history, so no poll runs during the journey.
  await waitForGeneratedAudio(page, conversionId, await readAccessToken(page));

  await recordLoadingStates(page);
  // A running clock that `stayAway` can move past Query's least garbage-collection time.
  await page.clock.install();
  const isPreloaded = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === audiobookPath;
  });
  await page.goto(`${origin}/app/recent`);
  const track = page.getByRole("list", { name: "Tracks" }).getByRole("link");
  await expect(track).toHaveCount(1);
  // The card in view preloads its track, so the first visit opens it without waiting.
  await isPreloaded;
  // A cold start may show loading states (rule 3); the journey records none after it.
  const recordedOnColdStart = (await readLoadingStateRecord(page)).length;
  /*
   * The track's view reads the history too, to tell an account's track from a trial one, and
   * requests it on opening. Waiting for that response keeps it from landing after `stayAway`.
   */
  const isHistoryRefreshed = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === HISTORY_PATH;
  });
  await track.click();
  await waitForAudiobook(page);
  await isHistoryRefreshed;
  // Long enough on the track that Recents' history is stale, so going back requests it again.
  await stayAway(page);

  const historyRequests = await holdRequests(page, (pathname) => pathname === HISTORY_PATH);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app/recent`);
  await expect.poll(historyRequests.countHeld).toBeGreaterThan(0);
  await expect(track).toHaveCount(1);
  await stayAway(page);

  const audiobookRequests = await holdRequests(page, (pathname) => pathname === audiobookPath);
  await track.click();
  await expect.poll(audiobookRequests.countHeld).toBeGreaterThan(0);
  await waitForAudiobook(page);

  expect((await readLoadingStateRecord(page)).slice(recordedOnColdStart)).toEqual([]);
  historyRequests.release();
  audiobookRequests.release();
});

/**
 * Holds every GET request whose path `isHeld` matches until `release`, then lets it reach the
 * Worker through the fixture's catch-all route. Install it after the screen's first visit: the
 * first visit's requests, preloads included, are not refetches.
 */
async function holdRequests(page: Page, isHeld: (pathname: string) => boolean) {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  let heldCount = 0;
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET" || !isHeld(new URL(route.request().url()).pathname)) {
      await route.fallback();
      return;
    }
    heldCount += 1;
    await released;
    await route.fallback();
  });
  return { countHeld: () => heldCount, release: () => release() };
}

/**
 * Stays away from a screen longer than Query keeps an unobserved query at the least (one second for
 * a suspense query), so a cache that does not keep it for the page lifetime has dropped it.
 */
async function stayAway(page: Page) {
  await page.clock.fastForward(5_000);
}
