import { validateAudiobookArtifacts } from "#test-e2e/artifacts.ts";
import { expect, test } from "#test-e2e/fixtures.ts";
import { openNewTrial, startConversion, waitForAudiobook } from "#test-e2e/journey.ts";

test("converts controlled source content into downloadable MP3 and EPUB artifacts", async ({
  page,
  workerEnvironment,
}) => {
  await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);
  const audioLink = page.getByRole("link", { name: "Download MP3" });
  const epubLink = page.getByRole("link", { name: "Download EPUB" });
  const audioUrl = await audioLink.getAttribute("href");
  const epubUrl = await epubLink.getAttribute("href");
  if (audioUrl === null || epubUrl === null) throw new Error("Audiobook download URL is missing");

  const [audioDownload] = await Promise.all([page.waitForEvent("download"), audioLink.click()]);
  expect(audioDownload.suggestedFilename()).toBe("audiobook.mp3");
  const [epubDownload] = await Promise.all([page.waitForEvent("download"), epubLink.click()]);
  expect(epubDownload.suggestedFilename()).toBe("audiobook.epub");

  await validateAudiobookArtifacts({
    audioUrl: new URL(audioUrl, page.url()).href,
    epubUrl: new URL(epubUrl, page.url()).href,
  });
});

test("loads audiobook audio from another origin", async ({ page, workerEnvironment }) => {
  await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);

  const playerHtml = await page.locator("audio").evaluate((element) => element.outerHTML);
  const crossOriginPage = await page.context().newPage();
  await crossOriginPage.setContent(playerHtml);
  await expect
    .poll(() =>
      crossOriginPage
        .locator("audio")
        .evaluate(
          (element) =>
            element instanceof HTMLAudioElement && element.readyState >= 1 && element.duration > 0,
        ),
    )
    .toBe(true);
  await crossOriginPage.close();
});

test.describe("provider failure and recovery", () => {
  test.use({ qaScenario: "tts-failure" });

  test("shows the failed conversion and succeeds after a local provider restart", async ({
    page,
    workerEnvironment,
  }) => {
    test.setTimeout(120_000);

    const { grantId } = await openNewTrial(page, workerEnvironment);
    await startConversion(page);
    await expect(
      page.getByRole("heading", { name: "Conversion failed.", exact: true }),
    ).toBeVisible({
      timeout: 90_000,
    });

    await workerEnvironment.restart("success");
    await page.goto(`${workerEnvironment.origin}/app/trials/${grantId}`);
    await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
    await startConversion(page);
    await expect(
      page.getByRole("heading", { name: "A deterministic document about careful testing" }),
    ).toBeVisible({ timeout: 90_000 });
  });
});
