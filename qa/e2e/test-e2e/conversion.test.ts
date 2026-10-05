import { validateAudioSegment } from "#test-e2e/artifacts.ts";
import { expect, test } from "#test-e2e/fixtures.ts";
import {
  getTrialSessionHeaders,
  openNewTrial,
  startConversion,
  waitForAudiobook,
} from "#test-e2e/journey.ts";
import { generateUnit } from "#test-e2e/synthesis.ts";

test("generates the selected unit while paused, then Play requests audio ahead and plays", async ({
  page,
  workerEnvironment,
}) => {
  await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);
  await expect
    .poll(
      async () =>
        (await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json()).length,
    )
    .toBe(1);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((audio) => audio instanceof HTMLAudioElement && audio.paused),
    )
    .toBe(true);
  await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(
      () =>
        page
          .locator("audio")
          .evaluate(
            (element) =>
              element instanceof HTMLAudioElement && !element.paused && element.currentTime > 0,
          ),
      { timeout: 60_000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const url = await page.locator("audio").getAttribute("src");
  if (!url) throw new Error("Segment URL missing");
  await validateAudioSegment({ audioUrl: url, page });
  const before = await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json();
  await page.reload();
  await waitForAudiobook(page);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json()).toEqual(
    before,
  );
});

test("trial article links require the owning grant session for reading and replay", async ({
  page,
  workerEnvironment,
}) => {
  await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const segment = await generateUnit(page, id);
  const beforeAnonymous = await (
    await fetch(workerEnvironment.origin + "/__qa/speech-calls")
  ).json();
  const anonymous = await page.context().browser()!.newContext();
  const reader = await anonymous.newPage();
  await reader.goto(page.url());
  await expect(
    reader.getByRole("heading", { name: "The article could not be loaded." }),
  ).toBeVisible();
  expect(
    (await anonymous.request.get(workerEnvironment.origin + `/api/audiobooks/${id}`)).status(),
  ).toBe(401);
  expect((await anonymous.request.get(segment.url)).status()).toBe(401);
  const response = await anonymous.request.post(
    workerEnvironment.origin + `/api/audiobooks/${id}/segments/1`,
    {
      headers: { "Content-Type": "application/json", "X-Create-Audiobook-From-URL-Request": "1" },
      data: { retry: false },
    },
  );
  expect(response.status()).toBe(401);
  const otherGrant = await workerEnvironment.createGrant();
  await reader.goto(otherGrant.trialLink);
  await expect(reader).toHaveURL(`${workerEnvironment.origin}/app/trials/${otherGrant.grantId}`);
  const otherGrantHeaders = await getTrialSessionHeaders(reader);
  expect(
    (
      await anonymous.request.get(`${workerEnvironment.origin}/api/grants/${otherGrant.grantId}`, {
        headers: otherGrantHeaders,
      })
    ).status(),
  ).toBe(200);
  expect((await anonymous.request.get(segment.url, { headers: otherGrantHeaders })).status()).toBe(
    401,
  );
  expect(
    (await page.request.get(segment.url, { headers: await getTrialSessionHeaders(page) })).status(),
  ).toBe(200);
  expect(await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json()).toEqual(
    beforeAnonymous,
  );
  await anonymous.close();
});

test.describe("unit failure and recovery", () => {
  test.use({ qaScenario: "tts-failure" });
  test("keeps prepared text after synthesis failure and retries the same unit", async ({
    page,
    workerEnvironment,
  }) => {
    test.setTimeout(120_000);
    await openNewTrial(page, workerEnvironment);
    await startConversion(page);
    await waitForAudiobook(page);
    await expect(page.getByRole("button", { name: "Retry segment" })).toBeVisible({
      timeout: 90_000,
    });
    await waitForAudiobook(page);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await workerEnvironment.restart("success");
    await page.getByRole("button", { name: "Retry segment" }).click();
    await expect
      .poll(
        () =>
          page
            .locator("audio")
            .evaluate(
              (element) =>
                element instanceof HTMLAudioElement && !element.paused && element.currentTime > 0,
            ),
        { timeout: 60_000 },
      )
      .toBe(true);
  });
});

test.describe("preparation recovery", () => {
  test.use({ qaScenario: "preparation-failure" });
  test("retries preparation on the same article and prepares its selected unit while paused", async ({
    page,
    workerEnvironment,
  }) => {
    await openNewTrial(page, workerEnvironment);
    await startConversion(page);
    const url = page.url();
    await expect(
      page.getByRole("heading", { name: "The article could not be prepared." }),
    ).toBeVisible({ timeout: 90000 });
    await workerEnvironment.restart("success");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await waitForAudiobook(page);
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json()).length,
      )
      .toBe(1);
  });
});
