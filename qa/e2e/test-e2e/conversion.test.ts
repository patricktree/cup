import { validateCoverImage, validateNarrationTrack } from "#test-e2e/artifacts.ts";
import { expect, test } from "#test-e2e/fixtures.ts";
import {
  getTrialSessionHeaders,
  openNewTrial,
  startConversion,
  waitForAudiobook,
} from "#test-e2e/journey.ts";
import { captureNarrationAudio, readNarrationAudio } from "#test-e2e/narration-audio.ts";
import { readAudiobook, waitForGeneratedAudio } from "#test-e2e/synthesis.ts";

test("generates audio for the whole document, then plays its narration track", async ({
  page,
  workerEnvironment,
}) => {
  await captureNarrationAudio(page);
  await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const segments = await waitForGeneratedAudio(page, id);
  expect(segments.length).toBeGreaterThan(1);
  const calls = await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json();
  expect(calls).toHaveLength(segments.length);

  const audiobook = await readAudiobook(page, id);
  if (audiobook.status !== "ready" || !audiobook.narrationTrack) {
    throw new Error("Expected a narration track once every segment has audio.");
  }
  const { narrationTrack } = audiobook;
  const units = audiobook.narrationDocument.synchronizationUnits;

  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
  const position = page.getByRole("slider");
  // The progress bar spans the whole narration track, as the element reads it from the file.
  await expect(position).toHaveAttribute("max", String(narrationTrack.durationMilliseconds));
  // Each audiobook response signs a fresh URL, so only the track itself is compared.
  const trackPath = new URL(narrationTrack.url).pathname;
  expect(new URL((await readNarrationAudio(page)).src).pathname).toBe(trackPath);

  // Playing crosses from the first unit into the second.
  await play.click();
  await expect(page.locator(`[id="${units[0]!.id}"]`)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(`[id="${units[1]!.id}"]`)).toHaveAttribute("aria-current", "true", {
    timeout: 30_000,
  });
  expect((await readNarrationAudio(page)).currentTime * 1_000).toBeGreaterThanOrEqual(
    narrationTrack.startMilliseconds[1]!,
  );

  // A unit tap seeks the same track to the unit's start offset.
  await page.getByRole("button", { name: "Play segment 3", exact: true }).click();
  await expect(page.locator(`[id="${units[2]!.id}"]`)).toHaveAttribute("aria-current", "true");
  const afterTap = await readNarrationAudio(page);
  expect(new URL(afterTap.src).pathname).toBe(trackPath);
  expect(afterTap.currentTime * 1_000).toBeGreaterThanOrEqual(narrationTrack.startMilliseconds[2]!);
  expect(afterTap.currentTime * 1_000).toBeLessThan(
    narrationTrack.startMilliseconds[3] ?? narrationTrack.durationMilliseconds,
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const pausedAt = (await readNarrationAudio(page)).currentTime;
  // A trial listener's position is kept on the device.
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), `cup:position:v1:${id}`))
    .toBe(
      JSON.stringify({
        synchronizationUnitId: units[2]!.id,
        offsetMilliseconds: Math.round(pausedAt * 1_000) - narrationTrack.startMilliseconds[2]!,
      }),
    );
  await validateNarrationTrack({ conversionId: id, origin: workerEnvironment.origin, page });

  // Reloading restores the position saved on pause, paused.
  await page.reload();
  await waitForAudiobook(page);
  await expect(play).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator(`[id="${units[2]!.id}"]`)).toHaveAttribute("aria-current", "true");
  await expect
    .poll(async () => (await readNarrationAudio(page)).currentTime)
    .toBeCloseTo(pausedAt, 2);
  expect((await readNarrationAudio(page)).paused).toBe(true);
  expect(await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json()).toEqual(
    calls,
  );
});

test("trial article links require the owning grant session for reading, and media its signed URL", async ({
  page,
  workerEnvironment,
}) => {
  const { grantId } = await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await waitForGeneratedAudio(page, id);
  const audiobook = await readAudiobook(page, id);
  if (audiobook.status !== "ready" || !audiobook.narrationTrack) {
    throw new Error("Expected a narration track once every segment has audio.");
  }
  const trackUrl = audiobook.narrationTrack.url;
  const trackPath = new URL(trackUrl).pathname;
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
    reader.getByRole("heading", { name: "The track could not be loaded." }),
  ).toBeVisible();
  expect(
    (await anonymous.request.get(workerEnvironment.origin + `/api/audiobooks/${id}`)).status(),
  ).toBe(401);
  expect((await anonymous.request.get(coverImageUrl)).status()).toBe(401);
  expect((await anonymous.request.get(workerEnvironment.origin + trackPath)).status()).toBe(401);
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
  for (const url of [coverImageUrl, workerEnvironment.origin + trackPath]) {
    expect((await anonymous.request.get(url, { headers: otherGrantHeaders })).status()).toBe(401);
  }
  // Media accepts only the signed media URL, not the owning grant session.
  const ownerHeaders = await getTrialSessionHeaders(page);
  expect(
    (
      await page.request.get(workerEnvironment.origin + trackPath, { headers: ownerHeaders })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.get(
        `${workerEnvironment.origin}/api/files/audiobooks/${id}/segments/0/audio.mp3`,
        { headers: ownerHeaders },
      )
    ).status(),
  ).toBe(404);
  expect((await anonymous.request.get(trackUrl)).status()).toBe(200);
  expect(await (await fetch(workerEnvironment.origin + "/__qa/speech-calls")).json()).toEqual(
    beforeAnonymous,
  );

  // Revoking the trial blocks its unexpired track URL, as it blocks the trial's other requests.
  const revocation = await fetch(
    `${workerEnvironment.origin}/api/operator/grants/${grantId}/revocation`,
    {
      method: "POST",
      headers: { "Cf-Access-Token": "local-access-token", "Content-Type": "application/json" },
      body: "{}",
    },
  );
  expect(revocation.status).toBe(200);
  expect((await anonymous.request.get(trackUrl)).status()).toBe(403);
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
    await expect(page.getByText("Audio could not be generated for this track.")).toBeVisible({
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
      page.getByRole("heading", { name: "This track could not be prepared." }),
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
