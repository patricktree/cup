import { expect, test } from "@playwright/test";

test("tapping narration starts playback from that unit, including nested text", async ({
  mount,
  page,
}) => {
  await page.addInitScript(() => {
    // Exercise the player without depending on the story's placeholder media URLs.
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      get() {
        return this.dataset["source"] ?? "";
      },
      set(source: string) {
        this.dataset["source"] = source;
      },
    });
    HTMLMediaElement.prototype.play = function () {
      // The standby element is started muted only to unlock it for later segment boundaries.
      if (!this.muted) document.documentElement.dataset["playedSource"] = this.src;
      return Promise.resolve();
    };
  });

  const component = await mount("routes/audiobooks.$conversionId/GatesNotesArticle");
  // The page records the source of the segment last started on the document element.
  const playback = page.locator("html");

  await component.locator("#narration-unit-0003").click();
  await expect(component.locator("#narration-unit-0003")).toHaveAttribute("aria-current", "true");
  await expect(playback).toHaveAttribute("data-played-source", /\/segments\/2\/audio\.mp3$/);
  await expect(component.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  const nestedText = component.locator("#narration-unit-0010 em");
  await nestedText.scrollIntoViewIfNeeded();
  const nestedTextBounds = await nestedText.boundingBox();
  expect(nestedTextBounds).not.toBeNull();
  await page.mouse.click(
    nestedTextBounds!.x + nestedTextBounds!.width / 2,
    nestedTextBounds!.y + nestedTextBounds!.height / 2,
  );
  await expect(component.locator("#narration-unit-0010")).toHaveAttribute("aria-current", "true");
  await expect(playback).toHaveAttribute("data-played-source", /\/segments\/9\/audio\.mp3$/);

  await component.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await component.getByRole("button", { name: "Play segment 10", exact: true }).click();
  await expect(component.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(playback).toHaveAttribute("data-played-source", /\/segments\/9\/audio\.mp3$/);

  await component.getByRole("button", { name: "Pause", exact: true }).click();
  const segmentButton = component.getByRole("button", { name: "Play segment 3", exact: true });
  await component.getByRole("button", { name: "Play segment 2", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(segmentButton).toBeFocused();
  expect(await segmentButton.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe(
    "none",
  );
  await segmentButton.press("Enter");
  await expect(component.locator("#narration-unit-0003")).toHaveAttribute("aria-current", "true");
  await expect(playback).toHaveAttribute("data-played-source", /\/segments\/2\/audio\.mp3$/);
  await expect(component.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await component.getByRole("button", { name: "Pause", exact: true }).click();
  await segmentButton.focus();
  await segmentButton.press("Space");
  await expect(component.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(
    component.getByRole("heading", {
      name: "The turbulent AI era is here. The choices we make now are critical.",
    }),
  ).toBeVisible();
});

test("renders audiobook without showing preparation skeletons", async ({ mount, page }) => {
  await page.addInitScript(() => {
    const skeletonSelector = '[aria-label="Preparing article"]';
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches(skeletonSelector) || node.querySelector(skeletonSelector))
          ) {
            document.documentElement.dataset["sawReaderSkeleton"] = "true";
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });

  const component = await mount("routes/audiobooks.$conversionId/ReadyAudiobook");
  await expect(
    component.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await expect(
    component.getByText("Keep the important boundaries real.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("link", { name: /Download/ })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.dataset["sawReaderSkeleton"]),
  ).toBeUndefined();
  await expect(component).toHaveScreenshot("audiobook.png");
});

test("shows generation progress and keeps Play disabled while audio is generated", async ({
  mount,
}) => {
  const component = await mount("routes/audiobooks.$conversionId/SynthesizingAudiobook");
  await expect(component.getByText("Generating audio… 1 of 3 segments ready")).toBeVisible();
  await expect(
    component.getByText("Keep the important boundaries real.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component).toHaveScreenshot("synthesizing-audiobook.png");
});

test("explains the needed and available duration when the document does not fit", async ({
  mount,
}) => {
  const component = await mount("routes/audiobooks.$conversionId/InsufficientDuration");
  await expect(
    component.getByText(
      "Not enough audio duration for this article. It needs about 12 min 34 s, and 1 min 35 s is available.",
    ),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component).toHaveScreenshot("insufficient-duration.png");
});

test("a failed segment is marked and playback needs an explicit choice to skip it", async ({
  mount,
}) => {
  const component = await mount("routes/audiobooks.$conversionId/AudiobookWithFailedSegment");
  await expect(
    component.getByText("Audio could not be generated for 1 segment, marked in the text."),
  ).toBeVisible();
  await expect(component.locator("#unit-2")).toHaveAttribute("data-synthesis-failed", "");
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component).toHaveScreenshot("audiobook-with-failed-segment.png");

  await component.getByRole("button", { name: "Play without it", exact: true }).click();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  // Two five-second segments remain on the timeline; the failed one takes no time.
  await expect(component.getByText("0:10", { exact: true })).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: "Play segment 2", exact: true })).toHaveCount(
    0,
  );

  // A refused retry leaves the audiobook unchanged, so the reader has to say why.
  await component.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    component.getByText(
      "Not enough audio duration to retry. The missing audio needs about 3 s, and 1 s is available.",
    ),
  ).toBeVisible();
});

test("an audiobook whose every segment failed offers only Retry", async ({ mount }) => {
  const component = await mount("routes/audiobooks.$conversionId/AudiobookWithoutAudio");
  await expect(
    component.getByText("Audio could not be generated for this article.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: /Play without/ })).toHaveCount(0);
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
});

test("renders audiobook-not-found", async ({ mount }) => {
  const component = await mount("routes/audiobooks.$conversionId/AudiobookNotFound");
  await expect(
    component.getByRole("heading", { name: "The article could not be loaded." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("audiobook-not-found.png");
});

test("renders audiobook-load-error", async ({ mount, page }) => {
  const component = await mount("routes/audiobooks.$conversionId/AudiobookLoadError");
  await expect(
    component.getByRole("heading", { name: "The article could not be loaded." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("audiobook-load-error.png");

  await page.route("**/api/audiobooks/*", (route) =>
    route.fulfill({
      json: { status: "pending", originalUrl: "https://example.com/article", canGenerate: true },
    }),
  );
  await component.getByRole("button", { name: "Try again" }).click();
  await expect(component.getByRole("status")).toHaveText("Preparing article…");
});

test("shows preparation skeletons with disabled Play", async ({ mount }) => {
  const component = await mount("routes/audiobooks.$conversionId/PendingConversion");
  await expect(component.getByRole("status")).toHaveText("Preparing article…");
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component).toHaveScreenshot("pending-conversion.png");
});
test("preparation failure replaces skeletons with Retry", async ({ mount }) => {
  const component = await mount("routes/audiobooks.$conversionId/FailedConversion");
  await expect(
    component.getByRole("heading", { name: "The article could not be prepared." }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component).toHaveScreenshot("failed-conversion.png");
});
