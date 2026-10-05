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
      this.dataset["playedSource"] = this.src;
      return Promise.resolve();
    };
  });

  const component = await mount("routes/audiobooks.$conversionId/GatesNotesArticle");
  const audio = component.locator("audio");

  await component.locator("#narration-unit-0003").click();
  await expect(component.locator("#narration-unit-0003")).toHaveAttribute("aria-current", "true");
  await expect(audio).toHaveAttribute("data-played-source", /\/segments\/2\/audio\.mp3$/);
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
  await expect(audio).toHaveAttribute("data-played-source", /\/segments\/9\/audio\.mp3$/);

  await component.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await component.getByRole("button", { name: "Play segment 10", exact: true }).click();
  await expect(component.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(audio).toHaveAttribute("data-played-source", /\/segments\/9\/audio\.mp3$/);

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
  await expect(audio).toHaveAttribute("data-played-source", /\/segments\/2\/audio\.mp3$/);
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
