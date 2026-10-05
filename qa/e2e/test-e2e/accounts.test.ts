import type { Page } from "@playwright/test";

import { audiobookSchema, accountSnapshotSchema } from "@cup/web-app-api.routes";

import { expect, test } from "#test-e2e/fixtures.ts";
import { waitForAudiobook } from "#test-e2e/journey.ts";
import { generateUnit } from "#test-e2e/synthesis.ts";

const SOURCE_URL = "https://source.example.test/fixture";

test("Google PKCE signup resumes conversion, protects history and media, and supports deletion recovery", async ({
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
  const mediaUrl = `${origin}/api/files/audiobooks/${conversionId}/segments/0/audio.mp3`;
  await waitForAudiobook(page);
  if (!conversionId) throw new Error("Conversion missing");
  await generateUnit(page, conversionId, 0, await readAccessToken(page));
  const remainingAllowance = (await readAccount(page, origin)).balance.available;
  expect(remainingAllowance).toBeLessThan(30 * 60 * 1_000);
  await page.reload();
  await waitForAudiobook(page);
  await expect
    .poll(() => page.evaluate(async (url) => (await fetch(url)).status, mediaUrl))
    .toBe(200);
  expect(
    (
      await page.request.get(mediaUrl, {
        headers: { Authorization: `Bearer ${authProvider.otherToken()}` },
      })
    ).status(),
  ).toBe(404);
  await page.goto(`${origin}/app/history`);
  await expect(page.getByRole("link", { name: "Open audiobook" })).toHaveCount(1);
  await expect(page.locator("main")).toHaveScreenshot("private-history.png");
  await page.goto(`${origin}/app/account`);
  await page.getByRole("button", { name: "Delete account…" }).click();
  await expect(page.getByRole("button", { name: "Schedule deletion" })).toBeVisible();
  await expect.poll(() => authProvider.exchanges()).toBe(2);
  await page.getByRole("button", { name: "Schedule deletion" }).click();
  await expect(
    page.getByText("Sign in with Google to manage or restore your account."),
  ).toBeVisible();
  await expect.poll(async () => (await page.request.get(mediaUrl)).status()).toBe(401);
  expectConsoleError(/^Failed to load resource: the server responded with a status of 403/);
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect.poll(() => authProvider.exchanges()).toBe(3);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.goto(`${origin}/app/account`);
  await expect(page.getByRole("heading", { name: "Deletion scheduled" })).toBeVisible();
  await page.getByRole("button", { name: "Restore account…" }).click();
  await expect.poll(() => authProvider.exchanges()).toBe(4);
  await page.getByRole("button", { name: "Confirm recovery" }).click();
  await expect(
    page.getByText(
      "Your account is restored. Your existing minutes and conversions are available again.",
    ),
  ).toBeVisible();
  expect((await readAccount(page, origin)).balance.available).toBe(remainingAllowance);
  await page.goto(`${origin}/app/history`);
  await expect(page.getByRole("link", { name: "Open audiobook" })).toHaveCount(1);
  let resumedRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/account/conversions"
    )
      resumedRequests += 1;
  });
  await page.goto(`${origin}/app/`);
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  expect(resumedRequests).toBe(1);
  await page.goto(`${origin}/app/history`);
  await expect(page.getByRole("link", { name: "Open audiobook" })).toHaveCount(2);
});

test("signup keeps trial conversions separate from the new account and its history", async ({
  page,
  workerEnvironment,
}) => {
  test.setTimeout(90_000);
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
  if (!originalId) throw new Error("Conversion missing");
  await generateUnit(page, originalId);
  let importRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/account/imports")) importRequests += 1;
  });
  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });
  await waitForAudiobook(page);
  const accountConversionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!accountConversionId) throw new Error("Conversion missing");
  const segment = await generateUnit(page, accountConversionId, 0, await readAccessToken(page));
  const expectedAllowance = 30 * 60 * 1_000 - Math.ceil(segment.durationMilliseconds);
  expect((await readAccount(page, origin)).balance.available).toBe(expectedAllowance);
  const privateUrl = page.url();
  const privateId = new URL(privateUrl).pathname.split("/").at(-1);
  expect(privateId).not.toBe(originalId);
  const accessToken = await readAccessToken(page);
  // Account authentication does not confer access to another grant's conversions.
  expect(
    (
      await page.request.get(`${origin}/api/conversions/${originalId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    ).status(),
  ).toBe(401);
  await page.goto(origin + "/app/history");
  const ownConversions = page.getByRole("link", { name: "Open audiobook" });
  await expect(ownConversions).toHaveCount(1);
  await expect(ownConversions).toHaveAttribute("href", new URL(privateUrl).pathname);
  expect(importRequests).toBe(0);
  await page.goto(`${origin}/app/account`);
  await page.getByRole("button", { name: "Delete account…", exact: true }).click();
  await page.getByRole("button", { name: "Schedule deletion", exact: true }).click();
  await expect
    .poll(async () =>
      (
        await page.request.get(`${origin}/api/files/audiobooks/${privateId}/segments/0/audio.mp3`)
      ).status(),
    )
    .toBe(401);
  expect(
    (
      await page.request.get(`${origin}/api/files/audiobooks/${originalId}/segments/0/audio.mp3`)
    ).status(),
  ).toBe(401);
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
    if (new URL(request.url()).pathname.startsWith(`/api/grants/${grant.grantId}`))
      trialRequests += 1;
  });
  await page.goto(trialUrl);
  await expect(page).toHaveURL(`${origin}/app/`);
  expect(trialRequests).toBe(0);
  await page.goto(`${origin}/app/account`);
  await page.getByRole("button", { name: "Delete account…", exact: true }).click();
  await page.getByRole("button", { name: "Schedule deletion", exact: true }).click();
  await expect(
    page.getByText("Sign in with Google to manage or restore your account."),
  ).toBeVisible();
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
    if (new URL(request.url()).pathname.startsWith(`/api/grants/${grant.grantId}`))
      trialRequests += 1;
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
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();

  await page.goto(`${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\/[^?]+$/, { timeout: 60_000 });
  expect(authProvider.exchanges()).toBe(1);
  await page.goto(`${origin}/app/history`);
  await expect(page.getByRole("link", { name: "Open audiobook" })).toHaveCount(2, {
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
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
});

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
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length > 1) return route.continue();
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

async function readAccessToken(page: Page) {
  return page.evaluate(() => {
    const stored = window.localStorage.getItem("cup_supabase_session");
    if (!stored) throw new Error("Expected an authenticated browser session");
    const session: unknown = JSON.parse(stored);
    if (
      !session ||
      typeof session !== "object" ||
      !("access_token" in session) ||
      typeof session.access_token !== "string"
    )
      throw new Error("Expected an access token");
    return session.access_token;
  });
}

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
  const document = audiobookSchema.parse(
    await (
      await page.request.get(origin + "/api/audiobooks/" + id, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json(),
  );
  if (document.status !== "ready") throw new Error("Article not prepared");
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
