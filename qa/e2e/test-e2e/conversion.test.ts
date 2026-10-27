import {
  validateAudioSegment,
  validateCoverImage,
  validateNarrationTrack,
} from "#test-e2e/artifacts.ts";
import { expect, test } from "#test-e2e/fixtures.ts";
import {
  getTrialSessionHeaders,
  openNewTrial,
  startConversion,
  waitForAudiobook,
} from "#test-e2e/journey.ts";
import { waitForGeneratedAudio } from "#test-e2e/synthesis.ts";

test("generates audio for the whole document, then plays it on one timeline", async ({
  page,
  workerEnvironment,
}) => {
  await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const segments = await waitForGeneratedAudio(page, id);
  expect(segments.length).toBeGreaterThan(1);
  const calls = await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json();
  expect(calls).toHaveLength(segments.length);

  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
  const position = page.getByRole("slider");
  // The progress bar spans every segment, not only the one playing.
  await expect(position).toHaveAttribute(
    "max",
    String(segments.reduce((total, segment) => total + segment.durationMilliseconds, 0)),
  );
  await play.click();
  await expect
    .poll(async () => Number(await position.inputValue()), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await validateAudioSegment({ audioUrl: segments[0]!.url, page });
  await validateNarrationTrack({ conversionId: id, origin: workerEnvironment.origin, page });

  await page.reload();
  await waitForAudiobook(page);
  await expect(play).toBeEnabled({ timeout: 30_000 });
  expect(await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json()).toEqual(
    calls,
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
  const segment = (await waitForGeneratedAudio(page, id))[0]!;
  const coverImageUrl = await validateCoverImage({
    conversionId: id,
    origin: workerEnvironment.origin,
    page,
  });
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
  expect((await anonymous.request.get(coverImageUrl)).status()).toBe(401);
  expect(
    (
      await anonymous.request.get(
        workerEnvironment.origin + `/api/files/audiobooks/${id}/narration-track.mp3`,
      )
    ).status(),
  ).toBe(401);
  const response = await anonymous.request.post(
    workerEnvironment.origin + `/api/audiobooks/${id}/retry`,
    {
      headers: { "Content-Type": "application/json", "X-Create-Audiobook-From-URL-Request": "1" },
      data: {},
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
    (await anonymous.request.get(coverImageUrl, { headers: otherGrantHeaders })).status(),
  ).toBe(401);
  expect(
    (await page.request.get(segment.url, { headers: await getTrialSessionHeaders(page) })).status(),
  ).toBe(200);
  expect(await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json()).toEqual(
    beforeAnonymous,
  );
  await anonymous.close();
});

test.describe("segment failure and recovery", () => {
  test.use({ qaScenario: "tts-failure" });
  test("keeps prepared text after synthesis failure and retries the failed segments", async ({
    page,
    workerEnvironment,
  }) => {
    test.setTimeout(120_000);
    await openNewTrial(page, workerEnvironment);
    await startConversion(page);
    await waitForAudiobook(page);
    await expect(page.getByText("Audio could not be generated for this article.")).toBeVisible({
      timeout: 90_000,
    });
    await waitForAudiobook(page);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    await workerEnvironment.restart("success");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({
      timeout: 60_000,
    });
    await expect(page.getByText(/Audio could not be generated/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Play without/ })).toHaveCount(0);
  });
});

test.describe("preparation recovery", () => {
  test.use({ qaScenario: "preparation-failure" });
  test("retries preparation on the same article and then generates its audio", async ({
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
    const segments = await waitForGeneratedAudio(page, new URL(url).pathname.split("/").at(-1)!);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    expect(
      await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json(),
    ).toHaveLength(segments.length);
  });
});
