import { expect, test, type Page } from "@playwright/test";

/** Records the source of the segment last started on the document element, without loading media. */
async function stubAudioPlayback(page: Page) {
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
      if (!this.muted) {
        document.documentElement.dataset["playedSource"] = this.src;
      }
      return Promise.resolve();
    };
  });
}

test("tapping narration starts playback from that unit, including nested text", async ({
  mount,
  page,
}) => {
  await stubAudioPlayback(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/GatesNotesArticle");
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

test("playback continues across pages until another audiobook is played", async ({
  mount,
  page,
}) => {
  await stubAudioPlayback(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/ListeningAcrossPages");
  const playback = page.locator("html");
  const player = component.getByRole("contentinfo", { name: "Player" });

  await component.getByRole("button", { name: "Play segment 2", exact: true }).click();
  await expect(playback).toHaveAttribute(
    "data-played-source",
    /example\.com\/segments\/1\/audio\.mp3$/,
  );
  await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await component.getByRole("link", { name: "Back to history" }).click();
  await expect(component.getByRole("heading", { name: "Conversion history" })).toBeVisible();
  await expect(
    player.getByRole("link", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(player).toHaveScreenshot("compact-player.png");

  await component
    .getByRole("listitem")
    .filter({ hasText: "A second document about listening" })
    .getByRole("link")
    .click();
  await expect(
    component.getByRole("main").getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  // Opening another audiobook does not interrupt the one playing.
  await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(
    player.getByRole("link", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();

  await component.getByRole("main").getByRole("button", { name: "Play", exact: true }).click();
  await expect(playback).toHaveAttribute(
    "data-played-source",
    /\/second\/segments\/0\/audio\.mp3$/,
  );
  await expect(
    player.getByRole("slider", { name: "Position in A second document about listening" }),
  ).toBeVisible();
  await expect(
    component.getByRole("main").getByRole("button", { name: "Play", exact: true }),
  ).toHaveCount(0);
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

  const component = await mount("routes/_shell.audiobooks.$conversionId/ReadyAudiobook");
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
  const component = await mount("routes/_shell.audiobooks.$conversionId/SynthesizingAudiobook");
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
  const component = await mount("routes/_shell.audiobooks.$conversionId/InsufficientDuration");
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
  const component = await mount(
    "routes/_shell.audiobooks.$conversionId/AudiobookWithFailedSegment",
  );
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
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookWithoutAudio");
  await expect(
    component.getByText("Audio could not be generated for this article.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: /Play without/ })).toHaveCount(0);
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
});

test("renders audiobook-not-found", async ({ mount }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookNotFound");
  await expect(
    component.getByRole("heading", { name: "The article could not be loaded." }),
  ).toBeVisible();
  await expect(component.getByText("The audiobook was not found.")).toBeVisible();
  // Trying again cannot find an audiobook that does not exist.
  await expect(component.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(component).toHaveScreenshot("audiobook-not-found.png");
});

test("renders audiobook-load-error", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookLoadError");
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
  await expect(component.getByLabel("Preparing article")).toHaveAttribute("aria-busy", "true");
});

test("shows preparation skeletons without playback controls", async ({ mount }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/PendingConversion");
  await expect(component.getByLabel("Preparing article")).toHaveAttribute("aria-busy", "true");
  await expect(component.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
  await expect(component).toHaveScreenshot("pending-conversion.png");
});
test("preparation failure replaces skeletons with Retry", async ({ mount }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/FailedConversion");
  await expect(
    component.getByRole("heading", { name: "The article could not be prepared." }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component).toHaveScreenshot("failed-conversion.png");
});

test("a refused retry is reported with a toast and leaves the reader in place", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/RetryRefused");
  await component.getByRole("button", { name: "Retry", exact: true }).click();

  // Base UI announces urgent toasts through an alert and hides the toast itself until focused.
  await expect(page.getByRole("alert")).toHaveText(
    "The retry could not start.This trial no longer permits new speech generation.",
  );
  await expect(
    component.getByText("Audio could not be generated for this article.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("retry-refused-toast.png");

  await page.getByRole("button", { name: "Dismiss", includeHidden: true }).click();
  await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
});

test("failed polling keeps the article and shows one toast until polling recovers", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/PollingInterrupted");
  const toasts = page.getByRole("alertdialog", { includeHidden: true });
  await expect(toasts).toHaveCount(1);
  await expect(toasts).toContainText("The article could not be updated.");

  // Three failed polls replace one toast, which closes once polling succeeds again.
  const toastCounts: number[] = [];
  await expect
    .poll(async () => {
      toastCounts.push(await toasts.count());
      return toastCounts.at(-1);
    })
    .toBe(0);
  expect(Math.max(...toastCounts)).toBe(1);
  await expect(component.getByText("Keep the important boundaries real.")).toBeVisible();
});
