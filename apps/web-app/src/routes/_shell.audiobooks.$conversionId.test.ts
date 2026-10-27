import { expect, test, type Page } from "@playwright/test";

/**
 * Keeps the player host's audio element reachable, which is never attached to the document. The
 * first one created is the host's: development mode runs state initializers twice and keeps the
 * first result.
 */
async function captureNarrationAudio(page: Page) {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(source?: string) {
        super(source);
        if (!("narrationAudio" in window)) {
          Object.assign(window, { narrationAudio: this });
        }
      }
    };
  });
}

async function readNarrationAudio(page: Page) {
  return page.evaluate(() => {
    const audio = "narrationAudio" in window ? window.narrationAudio : undefined;
    if (!(audio instanceof HTMLAudioElement)) {
      throw new Error("The player host created no audio element.");
    }
    return { src: audio.src, currentTime: audio.currentTime, paused: audio.paused };
  });
}

/** Waits until the element plays within a unit of five seconds that starts at `startSeconds`. */
async function expectPlayingFrom(page: Page, startSeconds: number) {
  await expect
    .poll(async () => {
      const { currentTime, paused } = await readNarrationAudio(page);
      return !paused && currentTime >= startSeconds && currentTime < startSeconds + 5;
    })
    .toBe(true);
}

test("tapping narration seeks the narration track to that unit, including nested text", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/GatesNotesArticle");

  await component.locator("#narration-unit-0003").click();
  await expect(component.locator("#narration-unit-0003")).toHaveAttribute("aria-current", "true");
  await expect(component.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectPlayingFrom(page, 10);

  const nestedText = component.locator("#narration-unit-0010 em");
  await nestedText.scrollIntoViewIfNeeded();
  const nestedTextBounds = await nestedText.boundingBox();
  expect(nestedTextBounds).not.toBeNull();
  await page.mouse.click(
    nestedTextBounds!.x + nestedTextBounds!.width / 2,
    nestedTextBounds!.y + nestedTextBounds!.height / 2,
  );
  await expect(component.locator("#narration-unit-0010")).toHaveAttribute("aria-current", "true");
  await expectPlayingFrom(page, 45);

  await component.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect((await readNarrationAudio(page)).paused).toBe(true);
  await component.getByRole("button", { name: "Play segment 2", exact: true }).click();
  await expect(component.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectPlayingFrom(page, 5);

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
  await expect(component.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectPlayingFrom(page, 10);

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

test("the position bar seeks the narration track", async ({ mount, page }) => {
  await captureNarrationAudio(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/ReadyAudiobook");
  const position = component.getByRole("slider", {
    name: "Position in A deterministic document about careful testing",
  });
  await position.fill("11000");

  await expect(component.locator("#unit-3")).toHaveAttribute("aria-current", "true");
  await expect.poll(async () => (await readNarrationAudio(page)).currentTime).toBe(11);
  expect((await readNarrationAudio(page)).paused).toBe(true);
});

test("playback continues across pages until another audiobook is played", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/ListeningAcrossPages");
  const player = component.getByRole("contentinfo", { name: "Player" });

  await component.getByRole("button", { name: "Play segment 2", exact: true }).click();
  await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectPlayingFrom(page, 5);
  expect((await readNarrationAudio(page)).src).toContain("audiobook=story");

  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(
    player.getByRole("link", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  // Paused, so the position bar holds still for the screenshot.
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await page.evaluate(() => {
    if ("narrationAudio" in window && window.narrationAudio instanceof HTMLAudioElement) {
      window.narrationAudio.currentTime = 5;
    }
  });
  await expect.poll(async () => (await readNarrationAudio(page)).currentTime).toBe(5);
  await expect(player).toHaveScreenshot("compact-player.png");
  await player.getByRole("button", { name: "Play", exact: true }).click();

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
  expect((await readNarrationAudio(page)).src).toContain("audiobook=story");

  await component.getByRole("main").getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    player.getByRole("slider", { name: "Position in A second document about listening" }),
  ).toBeVisible();
  expect((await readNarrationAudio(page)).src).toContain("audiobook=second");
  await expectPlayingFrom(page, 0);
  await expect(
    component.getByRole("main").getByRole("button", { name: "Play", exact: true }),
  ).toHaveCount(0);
});

test("a trial audiobook renders without preparation skeletons and leads back home", async ({
  mount,
  page,
}) => {
  await page.addInitScript(() => {
    const skeletonSelector = '[aria-label="Preparing track"]';
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
  await expect(component.getByText("source.example.test", { exact: true })).toBeVisible();
  await expect(
    component.getByText("Keep the important boundaries real.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("link", { name: /Download/ })).toHaveCount(0);
  await expect(component.getByRole("link", { name: "Back", exact: true })).toHaveAttribute(
    "href",
    "/app/",
  );
  await expect(component.getByRole("main").getByRole("status")).toHaveText("");
  expect(
    await page.evaluate(() => document.documentElement.dataset["sawReaderSkeleton"]),
  ).toBeUndefined();
  await expect(component).toHaveScreenshot("trial-audiobook.png");
});

test("an account audiobook opens with its cover, title and host below a plain top bar", async ({
  mount,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AccountAudiobook");
  const title = "The turbulent AI era is here. The choices we make now are critical.";

  await expect(component.getByRole("heading", { name: title })).toBeVisible();
  await expect(component.getByRole("img", { name: "A person reading by a window" })).toBeVisible();
  await expect(component.getByText("gatesnotes.com", { exact: true })).toBeVisible();
  const topBar = component.getByRole("banner");
  await expect(topBar.getByRole("link", { name: "Back", exact: true })).toHaveAttribute(
    "href",
    "/app/recent",
  );
  await expect(topBar.getByText(title)).toHaveCount(0);
  await expect(component).toHaveScreenshot("account-audiobook-at-start.png");
});

test("once the title scrolls away the top bar shows it, and the playing segment is highlighted", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/AccountAudiobook");
  const title = "The turbulent AI era is here. The choices we make now are critical.";
  const topBar = component.getByRole("banner");
  await expect(component.getByRole("heading", { name: title })).toBeVisible();

  const segment = component.locator("#narration-unit-0005");
  await segment.scrollIntoViewIfNeeded();
  await component.getByRole("button", { name: "Play segment 5", exact: true }).click();
  await expect(segment).toHaveAttribute("aria-current", "true");
  await expect(topBar.getByText(title)).toBeVisible();
  await expect(topBar.getByText("gatesnotes.com", { exact: true })).toBeVisible();

  // Paused at the segment's start, so nothing moves for the screenshot.
  await component.getByRole("button", { name: "Pause", exact: true }).click();
  await page.evaluate(() => {
    if ("narrationAudio" in window && window.narrationAudio instanceof HTMLAudioElement) {
      window.narrationAudio.currentTime = 20;
    }
  });
  await expect.poll(async () => (await readNarrationAudio(page)).currentTime).toBe(20);
  expect(await segment.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgba(18, 18, 18, 0.08)",
  );
  expect(await segment.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("400");
  await expect(component).toHaveScreenshot("account-audiobook-scrolled.png");

  await component.getByRole("main").evaluate((main) => main.scrollTo({ top: 0 }));
  await expect(topBar.getByText(title)).toHaveCount(0);
});

test("the top bar's menu opens the original page and retries", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AccountAudiobook");
  await expect(
    component.getByRole("heading", {
      name: "The turbulent AI era is here. The choices we make now are critical.",
    }),
  ).toBeVisible();
  await component.getByRole("button", { name: "More", exact: true }).click();

  const openOriginal = page.getByRole("menuitem", { name: "Open original page" });
  await expect(openOriginal).toHaveAttribute(
    "href",
    "https://www.gatesnotes.com/a-turbulent-ai-era-and-critical-choices-to-make",
  );
  await expect(openOriginal).toHaveAttribute("target", "_blank");
  await expect(page).toHaveScreenshot("menu-open.png");

  const retryRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/retry"),
  );
  await page.getByRole("menuitem", { name: "Retry", exact: true }).click();
  await retryRequest;
});

test("the top bar's menu offers no Retry when the audiobook cannot generate", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookWithoutRetry");
  await component.getByRole("button", { name: "More", exact: true }).click();

  await expect(page.getByRole("menuitem", { name: "Open original page" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Retry", exact: true })).toHaveCount(0);
});

test("shows generation progress and keeps Play disabled while audio is generated", async ({
  mount,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/SynthesizingAudiobook");
  await expect(component.getByRole("main").getByRole("status")).toHaveText(
    "Generating audio, 1 of 3 segments ready",
  );
  await expect(
    component.getByText("Keep the important boundaries real.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component.getByRole("button", { name: /^Play segment/ })).toHaveCount(0);
  await expect(component).toHaveScreenshot("synthesizing-audiobook.png");
});

test("explains the needed and available duration when the document does not fit", async ({
  mount,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/InsufficientDuration");
  await expect(
    component.getByText(
      "Not enough audio duration for this track. It needs about 12 min 34 s, and 1 min 35 s is available.",
    ),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component).toHaveScreenshot("insufficient-duration.png");
});

test("a failed segment is marked and playback waits for a successful Retry", async ({ mount }) => {
  const component = await mount(
    "routes/_shell.audiobooks.$conversionId/AudiobookWithFailedSegment",
  );
  await expect(
    component.getByText("Audio could not be generated for 1 segment, marked in the text."),
  ).toBeVisible();
  await expect(component.locator("#unit-2")).toHaveAttribute("data-synthesis-failed", "");
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component.getByRole("button", { name: /^Play segment/ })).toHaveCount(0);
  await expect(component.getByRole("button", { name: /Play without/ })).toHaveCount(0);
  await expect(component.getByText(/skipped during playback/)).toHaveCount(0);
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component).toHaveScreenshot("audiobook-with-failed-segment.png");

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
    component.getByText("Audio could not be generated for this track.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: /Play without/ })).toHaveCount(0);
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component.getByRole("button", { name: /^Play segment/ })).toHaveCount(0);
});

test("renders audiobook-not-found", async ({ mount }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookNotFound");
  await expect(
    component.getByRole("heading", { name: "The track could not be loaded." }),
  ).toBeVisible();
  await expect(component.getByText("The audiobook was not found.")).toBeVisible();
  // Trying again cannot find an audiobook that does not exist.
  await expect(component.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(component).toHaveScreenshot("audiobook-not-found.png");
});

test("renders audiobook-load-error", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookLoadError");
  await expect(
    component.getByRole("heading", { name: "The track could not be loaded." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("audiobook-load-error.png");

  await page.route("**/api/audiobooks/*", (route) =>
    route.fulfill({
      json: { status: "pending", originalUrl: "https://example.com/article", canGenerate: true },
    }),
  );
  await component.getByRole("button", { name: "Try again" }).click();
  await expect(component.getByLabel("Preparing track")).toHaveAttribute("aria-busy", "true");
});

test("shows loading skeletons with an unknown preparation phase", async ({ mount }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/LoadingAudiobook");
  await expect(component.getByLabel("Preparing track")).toHaveAttribute("aria-busy", "true");
  await expect(component.getByRole("main").getByRole("status")).toHaveText("Preparing");
  await expect(component).toHaveScreenshot("loading-audiobook.png");
});

test("shows preparation skeletons without playback controls", async ({ mount }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/PendingConversion");
  await expect(component.getByLabel("Preparing track")).toHaveAttribute("aria-busy", "true");
  await expect(component.getByRole("main").getByRole("status")).toHaveText("Preparing");
  await expect(component.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
  await expect(component).toHaveScreenshot("pending-conversion.png");
});

for (const [story, label] of [
  ["PendingStarting", "Starting"],
  ["PendingReadingPage", "Reading the page"],
  ["PendingSelectingContent", "Selecting narration content"],
  ["PendingPreparingText", "Preparing the text"],
] as const) {
  test(`the status line of a pending conversion reads "${label}"`, async ({ mount }) => {
    const component = await mount(`routes/_shell.audiobooks.$conversionId/${story}`);
    await expect(component.getByRole("main").getByRole("status")).toHaveText(label);
  });
}

test("preparation failure replaces skeletons with Retry", async ({ mount }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/FailedConversion");
  await expect(component.getByRole("heading", { name: "example.com", exact: true })).toBeVisible();
  await expect(
    component.getByRole("heading", { name: "This track could not be prepared." }),
  ).toBeVisible();
  await expect(
    component.getByText("Preparation failed. Retry to load this track.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: "More", exact: true })).toBeVisible();
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
    component.getByText("Audio could not be generated for this track.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("retry-refused-toast.png");

  await page.getByRole("button", { name: "Dismiss", includeHidden: true }).click();
  await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
});

test("failed polling keeps the track and shows one toast until polling recovers", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/PollingInterrupted");
  const toasts = page.getByRole("alertdialog", { includeHidden: true });
  await expect(toasts).toHaveCount(1);
  await expect(toasts).toContainText("The track could not be updated.");

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
