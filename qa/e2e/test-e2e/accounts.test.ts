import type { Page } from "@playwright/test";

import { accountSnapshotSchema } from "@cup/listener-api.routes";

import { expect, test } from "#test-e2e/fixtures.ts";
import { readAccessToken, waitForAudiobook } from "#test-e2e/journey.ts";
import { readAudiobook, waitForGeneratedAudio } from "#test-e2e/synthesis.ts";

const SOURCE_URL = "https://source.example.test/fixture";

test("Google PKCE signup resumes conversion, protects Recents and media, and supports deletion recovery", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  const { origin, authProvider } = workerEnvironment;
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  const signup = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(signup).toBeVisible();
  await expect(page).toHaveScreenshot("signup-prompt.png");
  await signup.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  expect(authProvider.exchanges()).toBe(1);
  const conversionId = new URL(page.url()).pathname.split("/").at(-1);
  await waitForAudiobook(page);
  if (!conversionId) {
    throw new Error("Conversion missing");
  }
  await waitForGeneratedAudio(page, conversionId, await readAccessToken(page));
  const audiobook = await readAudiobook(page, conversionId, await readAccessToken(page));
  if (audiobook.status !== "ready" || !audiobook.narrationTrack) {
    throw new Error("Expected a narration track once every segment has audio.");
  }
  // The signed media URL the player plays, issued to the signed-in account.
  const trackUrl = audiobook.narrationTrack.url;
  const remainingAllowance = (await readAccount(page, origin)).balance.available;
  expect(remainingAllowance).toBeLessThan(30 * 60 * 1_000);
  await page.reload();
  await waitForAudiobook(page);
  await expect
    .poll(() => page.evaluate(async (url) => (await fetch(url)).status, trackUrl))
    .toBe(200);
  // Media accepts only the signed media URL: neither the owner's nor another account's bearer token.
  const trackPath = new URL(trackUrl).pathname;
  for (const token of [await readAccessToken(page), authProvider.otherToken()]) {
    expect(
      (
        await page.request.get(origin + trackPath, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status(),
    ).toBe(401);
  }
  await page.goto(`${origin}/app/recent`);
  await expect(page.getByRole("list", { name: "Tracks" }).getByRole("link")).toHaveCount(1);
  await expect(page.locator("main")).toHaveScreenshot("private-recents.png");
  await page.goto(`${origin}/app/recent/account`);
  await page.getByRole("button", { name: "Delete account…" }).click();
  await expect(page.getByRole("button", { name: "Schedule deletion" })).toBeVisible();
  await expect.poll(() => authProvider.exchanges()).toBe(2);
  await scheduleDeletion(page);
  // Scheduling deletion signs the browser out, and signed out, Recents and its dialogs lead home.
  await expect(page).toHaveURL(`${origin}/app/`);
  // The unexpired signed URL is refused like a bearer request of an account scheduled for deletion.
  await expect.poll(async () => (await page.request.get(trackUrl)).status()).toBe(403);
  expectConsoleError(/^Failed to load resource: the server responded with a status of 403/);
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect.poll(() => authProvider.exchanges()).toBe(3);
  await expect(page.getByRole("alert")).toBeVisible();
  // The scheduled-deletion email links the account recovery page.
  await page.goto(`${origin}/app/account-recovery`);
  await expect(page.getByRole("heading", { name: "Deletion scheduled" })).toBeVisible();
  await page.getByRole("button", { name: "Restore account…" }).click();
  await expect.poll(() => authProvider.exchanges()).toBe(4);
  await page.getByRole("button", { name: "Confirm recovery" }).click();
  await expect(
    page.getByText(
      "Your account is restored. Your existing minutes and conversions are available again.",
    ),
  ).toBeVisible();
  // The restored account is active again; the confirmation replaces the page's notice for that.
  await expect(page.getByText("This account is not scheduled for deletion.")).toHaveCount(0);
  expect((await readAccount(page, origin)).balance.available).toBe(remainingAllowance);
  await page.goto(`${origin}/app/recent`);
  await expect(page.getByRole("list", { name: "Tracks" }).getByRole("link")).toHaveCount(1);
  let resumedRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/account/conversions"
    ) {
      resumedRequests += 1;
    }
  });
  await page.goto(`${origin}/app/`);
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  expect(resumedRequests).toBe(1);
  await page.goto(`${origin}/app/recent`);
  await expect(page.getByRole("list", { name: "Tracks" }).getByRole("link")).toHaveCount(2);
});

test("signup keeps trial conversions separate from the new account and its Recents", async ({
  page,
  request: isolatedRequest,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  const grant = await workerEnvironment.createGrant();
  const credential = new URL(grant.trialLink).hash;
  await page.goto(`${origin}/app/trials/${grant.grantId}${credential}`);
  await page.getByRole("textbox", { name: "URL" }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  const originalUrl = page.url();
  const originalId = new URL(originalUrl).pathname.split("/").at(-1);
  await waitForAudiobook(page);
  if (!originalId) {
    throw new Error("Conversion missing");
  }
  await waitForGeneratedAudio(page, originalId);
  let importRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/account/imports")) {
      importRequests += 1;
    }
  });
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  await waitForAudiobook(page);
  const accountConversionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!accountConversionId) {
    throw new Error("Conversion missing");
  }
  const segments = await waitForGeneratedAudio(
    page,
    accountConversionId,
    await readAccessToken(page),
  );
  const expectedAllowance =
    30 * 60 * 1_000 -
    segments.reduce((total, segment) => total + Math.ceil(segment.durationMilliseconds), 0);
  expect((await readAccount(page, origin)).balance.available).toBe(expectedAllowance);
  const privateAudiobook = await readAudiobook(
    page,
    accountConversionId,
    await readAccessToken(page),
  );
  if (privateAudiobook.status !== "ready" || !privateAudiobook.narrationTrack) {
    throw new Error("Expected a narration track once every segment has audio.");
  }
  const privateTrackUrl = privateAudiobook.narrationTrack.url;
  const privateUrl = page.url();
  const privateId = new URL(privateUrl).pathname.split("/").at(-1);
  expect(privateId).not.toBe(originalId);
  const accessToken = await readAccessToken(page);
  // Account authentication does not confer access to another grant's conversions. The isolated request context omits the trial session cookie this browser still holds.
  expect(
    (
      await isolatedRequest.get(`${origin}/api/audiobooks/${originalId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    ).status(),
  ).toBe(401);
  await page.goto(origin + "/app/recent");
  const ownConversions = page.getByRole("list", { name: "Tracks" }).getByRole("link");
  await expect(ownConversions).toHaveCount(1);
  await expect(ownConversions).toHaveAttribute("href", new URL(privateUrl).pathname);
  expect(importRequests).toBe(0);
  await page.goto(`${origin}/app/recent/account`);
  await page.getByRole("button", { name: "Delete account…", exact: true }).click();
  await scheduleDeletion(page);
  // Scheduling deletion signs the browser out. Its unexpired track URL is refused like a bearer
  // request of the account, and the track without a signed URL is refused outright.
  await expect.poll(async () => (await page.request.get(privateTrackUrl)).status()).toBe(403);
  expect((await page.request.get(origin + new URL(privateTrackUrl).pathname)).status()).toBe(401);
  expect(
    (
      await isolatedRequest.get(`${origin}/api/files/audiobooks/${originalId}/narration-track.mp3`)
    ).status(),
  ).toBe(401);

  // Signed out, the account recovery page that the scheduled-deletion email links signs in itself.
  await page.goto(`${origin}/app/account-recovery`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Deletion scheduled" })).toBeVisible();
  await expect(page).toHaveURL(`${origin}/app/account-recovery`);
});

test("signed-in accounts skip trial credentials and signed-out users can reopen trial links", async ({
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  const grant = await workerEnvironment.createGrant();
  const trialUrl = `${origin}/app/trials/${grant.grantId}${new URL(grant.trialLink).hash}`;
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });

  let trialRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(`/api/grants/${grant.grantId}`)) {
      trialRequests += 1;
    }
  });
  await page.goto(trialUrl);
  await expect(page).toHaveURL(`${origin}/app/recent`);
  expect(trialRequests).toBe(0);
  await page.goto(`${origin}/app/recent/account`);
  await page.getByRole("button", { name: "Delete account…", exact: true }).click();
  await scheduleDeletion(page);
  // Scheduling deletion signs the browser out, and signed out, Recents and its dialogs lead home.
  await expect(page).toHaveURL(`${origin}/app/`);
  await page.goto(trialUrl);
  await expect(page).toHaveURL(`${origin}/app/trials/${grant.grantId}`);
  await expect(page.getByRole("textbox", { name: "URL", exact: true })).toBeVisible();
  expect(trialRequests).toBeGreaterThan(0);
});

test("trial OAuth callback redirect does not depend on working authentication", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  const grant = await workerEnvironment.createGrant();
  await page.route("**/api/auth/config", (route) => route.fulfill({ status: 503 }));
  let trialRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(`/api/grants/${grant.grantId}`)) {
      trialRequests += 1;
    }
  });
  const query = "?code=test-code&from=google";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    expectConsoleError(/^Failed to load resource: the server responded with a status of 503/);
    await page.goto(
      `${origin}/app/trials/${grant.grantId}${query}${new URL(grant.trialLink).hash}`,
    );
    await expect(page).toHaveURL(`${origin}/app/${query}`);
    await expect(page.getByRole("textbox", { name: "URL", exact: true })).toBeVisible();
  }
  expect(trialRequests).toBe(0);
});

test("root auth handles signup and session restoration without account navigation", async ({
  page,
  workerEnvironment,
}) => {
  const { origin, authProvider } = workerEnvironment;
  await page.goto(`${origin}/app/`);
  await expect(page.getByRole("navigation", { name: "Account" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\/[^?]+$/, { timeout: 60_000 });
  expect(authProvider.exchanges()).toBe(1);
  const privateUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(privateUrl);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({
    timeout: 60_000,
  });

  await page.goto(`${origin}/app/recent/add`);
  const addDialog = page.getByRole("dialog", { name: "Add a track" });
  await addDialog.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await addDialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(addDialog).toHaveCount(0, { timeout: 60_000 });
  expect(authProvider.exchanges()).toBe(1);
  // Recents lists the new conversion next to the first and shows its title once it is prepared.
  const tracks = page.getByRole("list", { name: "Tracks" });
  await expect(tracks.getByRole("listitem")).toHaveCount(2);
  const titledTracks = tracks.getByRole("link", {
    name: "A deterministic document about careful testing",
  });
  await expect(titledTracks).toHaveCount(2, { timeout: 90_000 });
  await expect(tracks.getByText("source.example.test", { exact: true })).toHaveCount(2);
  // A card shows the source title only, never the source page's source subtitle.
  await expect(
    tracks.getByText("Real boundaries and fake providers make every run the same."),
  ).toHaveCount(0);
  // Its audio is generated without the detail view being open, so the newest track plays at once.
  await titledTracks.first().click();
  await expect(page).not.toHaveURL(privateUrl);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({
    timeout: 60_000,
  });
});

test("failed sign-in leaves anonymous trial access available", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  const grant = await workerEnvironment.createGrant();
  await page.route("**/api/auth/config", (route) => {
    expectConsoleError(/^Failed to load resource: the server responded with a status of 503/);
    return route.fulfill({
      status: 503,
      json: { error: { message: "Sign-in is temporarily unavailable." } },
    });
  });
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(
    page.getByText("Sign-in is temporarily unavailable.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto(`${origin}/app/trials/${grant.grantId}${new URL(grant.trialLink).hash}`);
  await expect(page).toHaveURL(`${origin}/app/trials/${grant.grantId}`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({
    timeout: 60_000,
  });
});

test("a listener deletes a track from its detail view, and the duration it used stays spent", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  const detailUrl = page.url();
  const conversionId = new URL(detailUrl).pathname.split("/").at(-1);
  if (!conversionId) {
    throw new Error("Conversion missing");
  }
  await waitForGeneratedAudio(page, conversionId, await readAccessToken(page));
  const remainingAllowance = (await readAccount(page, origin)).balance.available;
  expect(remainingAllowance).toBeLessThan(30 * 60 * 1_000);

  // Opened from Recents, so the history has a Recents entry below the detail view.
  await page.goto(`${origin}/app/recent`);
  await page.getByRole("list", { name: "Tracks" }).getByRole("link").click();
  await expect(page).toHaveURL(detailUrl);
  await waitForAudiobook(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete track?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();

  await expect(page).toHaveURL(`${origin}/app/recent`);
  await expect(page.getByRole("link", { name: "Add your first track" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tracks" })).toHaveCount(0);
  expectConsoleError(/^Failed to load resource: the server responded with a status of 404/);
  // React logs the one failed request twice: the error screen is in the route module, not in a lazy
  // chunk, since "keep error screens out of lazy route chunks".
  expectConsoleError(/^RpcError: Track not found\./);
  expectConsoleError(/^RpcError: Track not found\./);
  // The deletion went back to the Recents entry, so the deleted track is only the Forward entry.
  await page.goForward();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByText("Track not found.")).toBeVisible();
  expect((await readAccount(page, origin)).balance.available).toBe(remainingAllowance);
});

/**
 * Confirms the deletion once the covers on Recents behind the dialog have loaded: the account would
 * refuse one still loading, and a listener takes far longer to confirm than a test.
 */
async function scheduleDeletion(page: Page) {
  const confirm = page.getByRole("button", { name: "Schedule deletion", exact: true });
  await expect(confirm).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => image instanceof HTMLImageElement && image.complete),
        ),
    )
    .toBe(true);
  await confirm.click();
}

async function readAccount(page: Page, origin: string) {
  const accessToken = await readAccessToken(page);
  const response = await page.request.get(`${origin}/api/account`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok()).toBe(true);
  return accountSnapshotSchema.parse(await response.json());
}

test("a rate-limited resumed conversion waits for explicit retry and keeps its idempotency key", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  const keys: Array<string | undefined> = [];
  await page.route("**/api/account/conversions", (route) => {
    if (route.request().method() !== "POST") {
      return route.continue();
    }
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length > 1) {
      return route.continue();
    }
    expectConsoleError(/^Failed to load resource: the server responded with a status of 429/);
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "1" },
      json: { error: { message: "Try again shortly." } },
    });
  });
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Try again shortly.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "URL", exact: true })).toHaveValue(SOURCE_URL);
  await expect(page.getByRole("button", { name: "Load & listen" })).toBeEnabled();
  expect(keys).toHaveLength(1);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  expect(keys[0]).toBeTruthy();
  expect(keys).toEqual([keys[0], keys[0]]);
});

test("account positions restore once and use last-write-wins across players", async ({
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  await page.goto(origin + "/app/");
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60000 });
  await waitForAudiobook(page);
  const url = page.url();
  const id = new URL(url).pathname.split("/").at(-1)!;
  const token = await readAccessToken(page);
  await waitForGeneratedAudio(page, id, token);
  const document = await readAudiobook(page, id, token);
  if (document.status !== "ready") {
    throw new Error("Article not prepared");
  }
  const unitId = document.narrationDocument.synchronizationUnits[1]!.id;
  const save = await page.evaluate(
    async (input) => {
      return (
        await fetch(`/api/audiobooks/${input.id}/position`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Create-Audiobook-From-URL-Request": "1",
            Authorization: `Bearer ${input.token}`,
          },
          body: JSON.stringify({ synchronizationUnitId: input.unitId, offsetMilliseconds: 1200 }),
        })
      ).status;
    },
    { id, token, unitId },
  );
  expect(save).toBe(204);
  await page.reload();
  await waitForAudiobook(page);
  await expect(page.locator(`[id="${unitId}"]`)).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const second = await page.context().newPage();
  await second.goto(url);
  await waitForAudiobook(second);
  await expect(second.locator(`[id="${unitId}"]`)).toHaveAttribute("aria-current", "true");
  await second.getByRole("button", { name: "Play segment 3", exact: true }).click();
  await expect(second.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Pause", exact: true }).click();
  await expect
    .poll(async () => {
      const result = await page.request.get(origin + "/api/audiobooks/" + id, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (await result.json()).playbackPosition?.synchronizationUnitId;
    })
    .toBe(document.narrationDocument.synchronizationUnits[2]!.id);
  await expect(page.locator(`[id="${unitId}"]`)).toHaveAttribute("aria-current", "true");
  await page.reload();
  await waitForAudiobook(page);
  await expect(
    page.locator(`[id="${document.narrationDocument.synchronizationUnits[2]!.id}"]`),
  ).toHaveAttribute("aria-current", "true");
  await expect
    .poll(async () => (await (await fetch(origin + "/__qa/speech-calls")).json()).length)
    .toBe(document.narrationDocument.synchronizationUnits.length);
  await second.close();
});
