import { expect, test, type Locator, type Page } from "@playwright/test";

import { holdResponses, releaseResponses } from "#src/test-utils/held-responses.ts";
import {
  readLoadingStateRecord,
  recordLoadingStates,
} from "#src/test-utils/loading-state-recorder.ts";
import { recordReactUseWarnings } from "#src/test-utils/react-use-warnings.ts";

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

/** Goes back in history as the system Back gesture does, which no element of the page sees. */
async function goBackAsTheSystemDoes(page: Page) {
  await page.evaluate(() => {
    const goBack: unknown = Reflect.get(window, "goBackInAccountStory");
    if (typeof goBack !== "function") {
      throw new TypeError("The account story offers no Back");
    }
    Reflect.apply(goBack, window, []);
  });
}

/** The texts of the first three blocks of the narration document, inside an `<hgroup>` or not. */
async function readOpeningTexts(article: Locator) {
  return article.evaluate((element) =>
    [...element.querySelectorAll(":scope > *, :scope > hgroup > *")]
      .filter((block) => block.tagName !== "HGROUP")
      .slice(0, 3)
      .map((block) => block.textContent.trim()),
  );
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

test("without a source subtitle the host follows the title directly", async ({ mount }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/ReadyAudiobook");

  expect(await readOpeningTexts(component.getByRole("article"))).toEqual([
    "A deterministic document about careful testing",
    "source.example.test",
    "Keep the important boundaries real.",
  ]);
  await expect(component.locator("hgroup")).toHaveCount(0);
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

test("playback continues across pages until the player sheet plays another audiobook", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/ListeningAcrossPages");
  const playerSheet = component.getByRole("contentinfo", { name: "Player" });
  const miniPlayer = component.getByRole("region", { name: "Player" });

  await component.getByRole("button", { name: "Play segment 2", exact: true }).click();
  await expect(playerSheet.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectPlayingFrom(page, 5);
  expect((await readNarrationAudio(page)).src).toContain("audiobook=story");

  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(playerSheet).toHaveCount(0);
  await expect(
    miniPlayer.getByRole("link", { name: /^A deterministic document about careful testing/ }),
  ).toBeVisible();
  await expect(miniPlayer.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectPlayingFrom(page, 5);

  await component
    .getByRole("listitem")
    .filter({ hasText: "A second document about listening" })
    .getByRole("link")
    .click();
  // Opening another audiobook does not interrupt the one playing; its sheet shows its own start.
  await expect(
    playerSheet.getByRole("slider", { name: "Position in A second document about listening" }),
  ).toHaveValue("0");
  await expect(playerSheet.getByText("0:00", { exact: true })).toBeVisible();
  await expect(playerSheet.getByText("-0:15", { exact: true })).toBeVisible();
  await expect(miniPlayer).toHaveCount(0);
  expect((await readNarrationAudio(page)).paused).toBe(false);
  expect((await readNarrationAudio(page)).src).toContain("audiobook=story");

  await playerSheet.getByRole("button", { name: "Play", exact: true }).click();
  await expect(playerSheet.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect((await readNarrationAudio(page)).src).toContain("audiobook=second");
  await expectPlayingFrom(page, 0);
});

test("the player sheet skips 15 seconds back and forward, within the track", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/ReadyAudiobook");
  const playerSheet = component.getByRole("contentinfo", { name: "Player" });
  const position = playerSheet.getByRole("slider", {
    name: "Position in A deterministic document about careful testing",
  });
  await expect(position).toBeEnabled();

  await position.fill("4000");
  await expect.poll(async () => (await readNarrationAudio(page)).currentTime).toBe(4);
  await playerSheet.getByRole("button", { name: "Back 15 seconds", exact: true }).click();
  await expect.poll(async () => (await readNarrationAudio(page)).currentTime).toBe(0);

  await playerSheet.getByRole("button", { name: "Forward 15 seconds", exact: true }).click();
  await expect(playerSheet.getByText("-0:00", { exact: true })).toBeVisible();
  // The timeline ends a millisecond short of the track, so the element never reaches its end.
  await expect.poll(async () => (await readNarrationAudio(page)).currentTime).toBe(14.999);
  expect((await readNarrationAudio(page)).paused).toBe(true);
});

test("before an audiobook is loaded, the player sheet skips from its stored position", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/ResumingAcrossPages");
  const playerSheet = component.getByRole("contentinfo", { name: "Player" });

  await component.getByRole("button", { name: "Play segment 2", exact: true }).click();
  await expectPlayingFrom(page, 5);
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await component
    .getByRole("listitem")
    .filter({ hasText: "A second document about listening" })
    .getByRole("link")
    .click();
  await expect(playerSheet.getByText("0:00", { exact: true })).toBeVisible();
  await expect(playerSheet.getByText("-0:30", { exact: true })).toBeVisible();

  // The listener stopped 12 s in.
  await playerSheet.getByRole("button", { name: "Forward 15 seconds", exact: true }).click();
  await expect(playerSheet.getByText("0:27", { exact: true })).toBeVisible();
  expect((await readNarrationAudio(page)).src).toContain("audiobook=second");
  await expect.poll(async () => (await readNarrationAudio(page)).currentTime).toBe(27);

  await playerSheet.getByRole("button", { name: "Back 15 seconds", exact: true }).click();
  await expect.poll(async () => (await readNarrationAudio(page)).currentTime).toBe(12);
  expect((await readNarrationAudio(page)).paused).toBe(true);
});

test("the player sheet shows the start of an audiobook with a narration track", async ({
  mount,
}) => {
  const enabled = await mount("routes/_shell.audiobooks.$conversionId/ReadyAudiobook");
  const enabledSheet = enabled.getByRole("contentinfo", { name: "Player" });
  await expect(enabledSheet.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(enabledSheet.getByText("0:00", { exact: true })).toBeVisible();
  await expect(enabledSheet.getByText("-0:15", { exact: true })).toBeVisible();
  await expect(enabledSheet).toHaveScreenshot("player-sheet-enabled.png");
});

test("the player sheet is disabled until the audiobook has a narration track", async ({
  mount,
}) => {
  const disabled = await mount("routes/_shell.audiobooks.$conversionId/SynthesizingAudiobook");
  const disabledSheet = disabled.getByRole("contentinfo", { name: "Player" });
  await expect(disabledSheet.getByRole("status")).toHaveText(
    "Generating audio, 1 of 3 segments ready",
  );
  for (const name of ["Back 15 seconds", "Play", "Forward 15 seconds"]) {
    await expect(disabledSheet.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(disabledSheet.getByRole("slider")).toBeDisabled();
  await expect(disabledSheet.getByText("-:--", { exact: true })).toHaveCount(2);
  await expect(disabledSheet).toHaveScreenshot("player-sheet-disabled.png");
});

test("a trial audiobook renders without a loading state and leads back home", async ({
  mount,
  page,
}) => {
  await recordLoadingStates(page);

  const component = await mount("routes/_shell.audiobooks.$conversionId/ReadyAudiobook");
  await expect(
    component.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await expect(
    component.getByRole("article").getByText("source.example.test", { exact: true }),
  ).toBeVisible();
  await expect(
    component.getByText("Keep the important boundaries real.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("link", { name: /Download/ })).toHaveCount(0);
  await expect(component.getByRole("link", { name: "Back", exact: true })).toHaveAttribute(
    "href",
    "/app/",
  );
  await expect(
    component.getByRole("contentinfo", { name: "Player" }).getByRole("status"),
  ).toHaveText("");
  expect(await readLoadingStateRecord(page)).toEqual([]);
  await expect(page).toHaveScreenshot("trial-audiobook.png");
});

test("Back after a deep link opens Recents as a new entry above the track", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AccountAudiobook");
  const title = component.getByRole("heading", {
    name: "The turbulent AI era is here. The choices we make now are critical.",
  });
  await expect(title).toBeVisible();

  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();

  // Back pushed Recents, so the system Back returns to the track below it.
  await goBackAsTheSystemDoes(page);
  await expect(title).toBeVisible();
});

test("an account audiobook opens with its cover, title and host below a plain top bar", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AccountAudiobook");
  const title = "The turbulent AI era is here. The choices we make now are critical.";

  await expect(component.getByRole("heading", { name: title })).toBeVisible();
  await expect(component.getByRole("img", { name: "A person reading by a window" })).toBeVisible();
  await expect(
    component.getByRole("article").getByText("gatesnotes.com", { exact: true }),
  ).toBeVisible();
  expect(await readOpeningTexts(component.getByRole("article"))).toEqual([
    title,
    "We need a plan to ensure that the good outweighs the bad.",
    "gatesnotes.com",
  ]);
  const topBar = component.getByRole("banner");
  await expect(topBar.getByRole("link", { name: "Back", exact: true })).toHaveAttribute(
    "href",
    "/app/recent",
  );
  await expect(topBar.getByText(title)).toBeHidden();
  await expect(page).toHaveScreenshot("account-audiobook-at-start.png");
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
  await expect(page).toHaveScreenshot("account-audiobook-scrolled.png");

  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await expect(topBar.getByText(title)).toBeHidden();
});

test("the top bar's menu opens the original page", async ({ mount, page }) => {
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
  // Offered once the account history lists the track.
  await expect(page.getByRole("menuitem", { name: "Delete track…" })).toBeVisible();
  // Every segment has audio, so there is nothing to retry.
  await expect(page.getByRole("menuitem", { name: "Retry", exact: true })).toHaveCount(0);
  await expect(page).toHaveScreenshot("menu-open.png");
});

test("the top bar's menu retries an audiobook with a failed segment", async ({ mount, page }) => {
  const component = await mount(
    "routes/_shell.audiobooks.$conversionId/AudiobookWithFailedSegment",
  );
  await component.getByRole("button", { name: "More", exact: true }).click();

  const retryRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/retry"),
  );
  await page.getByRole("menuitem", { name: "Retry", exact: true }).click();
  await retryRequest;
});

test("the top bar's menu offers Retry after preparation failed", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/FailedConversion");
  await component.getByRole("button", { name: "More", exact: true }).click();

  await expect(page.getByRole("menuitem", { name: "Retry", exact: true })).toBeVisible();
});

test("the top bar's menu offers Retry when the duration did not suffice", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/InsufficientDuration");
  await component.getByRole("button", { name: "More", exact: true }).click();

  await expect(page.getByRole("menuitem", { name: "Retry", exact: true })).toBeVisible();
});

for (const story of ["PendingConversion", "SynthesizingAudiobook"] as const) {
  test(`the top bar's menu offers no Retry while the conversion runs (${story})`, async ({
    mount,
    page,
  }) => {
    const component = await mount(`routes/_shell.audiobooks.$conversionId/${story}`);
    await component.getByRole("button", { name: "More", exact: true }).click();

    await expect(page.getByRole("menuitem", { name: "Open original page" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Retry", exact: true })).toHaveCount(0);
  });
}

test("the top bar's menu offers no Retry when the audiobook cannot generate", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookWithoutRetry");
  await component.getByRole("button", { name: "More", exact: true }).click();

  await expect(page.getByRole("menuitem", { name: "Open original page" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Retry", exact: true })).toHaveCount(0);
});

for (const [status, story] of [
  ["pending", "AccountPendingConversion"],
  ["ready", "AccountAudiobook"],
  ["failed", "AccountFailedConversion"],
] as const) {
  test(`the top bar's menu ends with a destructive Delete track… for a ${status} track`, async ({
    mount,
    page,
  }) => {
    const component = await mount(`routes/_shell.audiobooks.$conversionId/${story}`);
    await component.getByRole("button", { name: "More", exact: true }).click();

    const items = page.getByRole("menuitem");
    await expect(items.last()).toHaveText("Delete track…");
    const [deleteColor, errorColor] = await items.last().evaluate((item) => [
      getComputedStyle(item).color,
      // Resolves the error token to the same color notation as the item's computed color.
      (() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-error)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })(),
    ]);
    expect(deleteColor).toBe(errorColor);
  });
}

test("a trial audiobook's menu offers no Delete track…", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/ReadyAudiobook");
  await component.getByRole("button", { name: "More", exact: true }).click();

  await expect(page.getByRole("menuitem", { name: "Open original page" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete track…" })).toHaveCount(0);
});

test("a signed-in listener's menu offers no Delete track… for a trial audiobook", async ({
  mount,
  page,
}) => {
  const historyResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/account/conversions",
  );
  const component = await mount(
    "routes/_shell.audiobooks.$conversionId/AccountOpensTrialAudiobook",
  );
  await historyResponse;
  await component.getByRole("button", { name: "More", exact: true }).click();

  await expect(page.getByRole("menuitem", { name: "Open original page" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete track…" })).toHaveCount(0);
});

test("the top bar's menu offers Delete track… for a track on a later page of the account history", async ({
  mount,
  page,
}) => {
  const component = await mount(
    "routes/_shell.audiobooks.$conversionId/AccountAudiobookOnLaterHistoryPage",
  );
  await component.getByRole("button", { name: "More", exact: true }).click();

  await expect(page.getByRole("menuitem", { name: "Delete track…" })).toBeVisible();
});

test("Delete track… asks first, starts on Cancel, and Escape keeps the track", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/DeleteTrack");
  const more = component.getByRole("button", { name: "More", exact: true });
  await more.click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();

  const dialog = page.getByRole("alertdialog", { name: "Delete track?" });
  await expect(dialog).toHaveAccessibleDescription(
    "The track will be deleted permanently. The audio duration it used is not returned to your allowance.",
  );
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  await expect(page).toHaveScreenshot("delete-track-dialog.png");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(
    component.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  expect(await page.evaluate(() => "deletionRequest" in window)).toBe(false);
});

test("deleting a track unloads the player first, then lands on Recents without it", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);
  const component = await mount("routes/_shell.audiobooks.$conversionId/DeleteTrack");
  // The account story mounts the shell, and with it the player's audio element, once signed in.
  await expect(
    component.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await expect.poll(async () => (await readNarrationAudio(page)).src).toContain("audiobook=story");

  await component.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete track?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();

  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(component.getByRole("status").filter({ hasText: "Track deleted." })).toHaveCount(1);
  // Recents is empty once the deleted track is gone from it.
  await expect(component.getByRole("link", { name: "Add your first track" })).toBeVisible();
  expect(await page.evaluate((): unknown => Reflect.get(window, "deletionRequest"))).toEqual(
    // The session-mutation guard of the API refuses a request without a JSON content type.
    { contentType: "application/json", narrationAudioSrc: "" },
  );
  // Deleting replaced the detail entry, so Back cannot return to it.
  await page.evaluate(() => {
    const goBack: unknown = Reflect.get(window, "goBackInAccountStory");
    if (typeof goBack !== "function") {
      throw new TypeError("The account story offers no Back");
    }
    Reflect.apply(goBack, window, []);
  });
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
});

test("a track already deleted elsewhere counts as deleted", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/DeleteTrackAlreadyDeleted");
  await component.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(component.getByRole("status").filter({ hasText: "Track deleted." })).toHaveCount(1);
  await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
});

test("while the deletion runs both buttons are disabled and the dialog stays open", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/DeleteTrackNeverAnswers");
  await component.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete track?" });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(dialog.getByRole("button", { name: "Deleting…", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
});

test("a failed deletion keeps the dialog open with an inline error, the player unloaded, and allows a retry", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);
  const component = await mount("routes/_shell.audiobooks.$conversionId/DeleteTrackFailsOnce");
  // The account story mounts the shell, and with it the player's audio element, once signed in.
  await expect(
    component.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await expect.poll(async () => (await readNarrationAudio(page)).src).toContain("audiobook=story");
  await component.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete track?" });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(dialog.getByRole("alert")).toHaveText("The track could not be deleted.");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  // The failure is shown in the dialog only: no toast opens.
  await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(1);
  expect((await readNarrationAudio(page)).src).toBe("");

  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
});

test("a pending track is deleted without its polling showing the deletion as an error", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/DeletePendingTrack");
  await component.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
});

test("deleting a track opened from Recents returns to Recents where it was, without the track", async ({
  mount,
  page,
}) => {
  const component = await mount(
    "routes/_shell.audiobooks.$conversionId/DeleteTrackOpenedFromRecents",
  );
  const deletableCard = component.getByRole("link", {
    name: "A deterministic document about careful testing",
  });
  await deletableCard.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await deletableCard.click();
  await component.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete track?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();

  await expect(component.getByRole("status").filter({ hasText: "Track deleted." })).toHaveCount(1);
  await expect(deletableCard).toHaveCount(0);
  // The track listed just above the deleted one is still in view.
  await expect(
    component.getByRole("link", { name: "Another track 30", exact: true }),
  ).toBeInViewport();

  await goBackAsTheSystemDoes(page);
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(
    component.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toHaveCount(0);
});

test("after a deletion, Recents' cached history lacks the track while its refetch is held", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/DeleteTrack");
  await expect(
    component.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await component.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete track…" }).click();

  await holdResponses(page, "account-history");
  await page
    .getByRole("alertdialog", { name: "Delete track?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();

  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(component.getByRole("link", { name: "Add your first track" })).toBeVisible();
  await releaseResponses(page, "account-history");
  await expect(component.getByRole("link", { name: "Add your first track" })).toBeVisible();
});

test("an audiobook opened again loads at the position saved meanwhile, while its refetch is held", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);
  await page.clock.install();
  const component = await mount("routes/_shell.audiobooks.$conversionId/ListeningAcrossPages");
  const playerSheet = component.getByRole("contentinfo", { name: "Player" });
  const openFromRecents = async (title: string) => {
    await component.getByRole("link", { name: "Back", exact: true }).click();
    await component.getByRole("listitem").filter({ hasText: title }).getByRole("link").click();
  };

  await component.getByRole("button", { name: "Play segment 2", exact: true }).click();
  await expectPlayingFrom(page, 5);
  // Playing another audiobook saves the listening position in this one.
  await openFromRecents("A second document about listening");
  await playerSheet.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await readNarrationAudio(page)).src).toContain("audiobook=second");
  // Longer than Query keeps an unobserved suspense query at the least, one second.
  await page.clock.fastForward(5_000);

  await holdResponses(page, "audiobook:693af4c4-9fa8-430d-9dc5-c00e88fb38a7");
  await openFromRecents("A deterministic document about careful testing");
  await playerSheet.getByRole("button", { name: "Play", exact: true }).click();

  await expect.poll(async () => (await readNarrationAudio(page)).src).toContain("audiobook=story");
  await expectPlayingFrom(page, 5);
  await releaseResponses(page, "audiobook:693af4c4-9fa8-430d-9dc5-c00e88fb38a7");
});

test("a track found gone when its audio is requested again is unloaded and reported", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);
  const component = await mount("routes/_shell.audiobooks.$conversionId/TrackGoneOnRenewal");
  const playerSheet = component.getByRole("contentinfo", { name: "Player" });
  await expect(playerSheet.getByRole("alert")).toHaveText(
    "Audio could not be played. Press Play to try again.",
  );

  await playerSheet.getByRole("button", { name: "Play", exact: true }).click();

  await expect(playerSheet.getByRole("alert")).toHaveText("This track is no longer available.");
  await expect(playerSheet.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  expect((await readNarrationAudio(page)).src).toBe("");
  // The player reports it in place: no toast opens.
  await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
});

test("shows generation progress and keeps Play disabled while audio is generated", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/SynthesizingAudiobook");
  await expect(
    component.getByRole("contentinfo", { name: "Player" }).getByRole("status"),
  ).toHaveText("Generating audio, 1 of 3 segments ready");
  await expect(
    component.getByText("Keep the important boundaries real.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component.getByRole("button", { name: /^Play segment/ })).toHaveCount(0);
  await expect(page).toHaveScreenshot("synthesizing-audiobook.png");
});

test("explains the needed and available duration when the document does not fit", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/InsufficientDuration");
  await expect(
    component.getByText(
      "Not enough audio duration for this track. It needs about 12 min 34 s, and 1 min 35 s is available.",
    ),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(page).toHaveScreenshot("insufficient-duration.png");
});

test("a failed segment is marked and playback waits for a successful Retry", async ({
  mount,
  page,
}) => {
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
  await expect(page).toHaveScreenshot("audiobook-with-failed-segment.png");

  // A refused retry leaves the audiobook unchanged, so the reader has to say why.
  await component.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    component.getByText(
      "Not enough audio duration to retry. The missing audio needs about 3 s, and 1 s is available.",
    ),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("retry-refused-for-duration.png");
});

test("an audiobook whose generation waits for freed duration asks for a Retry", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookNotYetGenerated");
  await expect(
    component.getByText("Audio has not been generated for this track yet.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(page).toHaveScreenshot("audiobook-not-yet-generated.png");
});

test("an audiobook whose every segment failed offers only Retry", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookWithoutAudio");
  await expect(
    component.getByText("Audio could not be generated for this track.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component.getByRole("button", { name: /Play without/ })).toHaveCount(0);
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component.getByRole("button", { name: /^Play segment/ })).toHaveCount(0);
  await expect(page).toHaveScreenshot("audiobook-without-audio.png");
});

test("renders audiobook-not-found", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookNotFound");
  await expect(
    component.getByRole("heading", { name: "The track could not be loaded." }),
  ).toBeVisible();
  await expect(component.getByText("Track not found.")).toBeVisible();
  // Trying again cannot find an audiobook that does not exist.
  await expect(component.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page).toHaveScreenshot("audiobook-not-found.png");
});

test("renders audiobook-load-error", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/AudiobookLoadError");
  await expect(
    component.getByRole("heading", { name: "The track could not be loaded." }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("audiobook-load-error.png");

  // The story answers the next request with a conversion still being prepared.
  await component.getByRole("button", { name: "Try again" }).click();
  await expect(component.getByLabel("Preparing track")).toHaveAttribute("aria-busy", "true");
});

test("shows loading skeletons with an unknown preparation phase", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/LoadingAudiobook");
  const skeleton = component.getByLabel("Loading track");
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  await expect(skeleton).toHaveAttribute("data-loading-state", "");
  await expect(component.getByLabel("Preparing track")).toHaveCount(0);
  await expect(
    component.getByRole("contentinfo", { name: "Player" }).getByRole("status"),
  ).toHaveText("Preparing");
  await expect(page).toHaveScreenshot("loading-audiobook.png");
});

test("shows preparation skeletons with a disabled player sheet", async ({ mount, page }) => {
  const component = await mount("routes/_shell.audiobooks.$conversionId/PendingConversion");
  const skeleton = component.getByLabel("Preparing track");
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  // A conversion still being prepared is content, not a loading state.
  await expect(skeleton).not.toHaveAttribute("data-loading-state");
  await expect(
    component.getByRole("contentinfo", { name: "Player" }).getByRole("status"),
  ).toHaveText("Preparing");
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  // The loading state looks the same apart from the menu, which only the loaded page has.
  await expect(component.getByRole("button", { name: "More", exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("pending-conversion.png");
});

for (const [story, label] of [
  ["PendingStarting", "Starting"],
  ["PendingReadingPage", "Reading the page"],
  ["PendingSelectingContent", "Selecting narration content"],
  ["PendingPreparingText", "Preparing the text"],
] as const) {
  test(`the status line of a pending conversion reads "${label}"`, async ({ mount }) => {
    const component = await mount(`routes/_shell.audiobooks.$conversionId/${story}`);
    await expect(
      component.getByRole("contentinfo", { name: "Player" }).getByRole("status"),
    ).toHaveText(label);
  });
}

test("preparation failure replaces skeletons with Retry", async ({ mount, page }) => {
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
  await expect(page).toHaveScreenshot("failed-conversion.png");
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

for (const { story, message } of [
  { story: "TrackGoneWhilePolling", message: "Track not found." },
  { story: "TrackAccessDeniedWhilePolling", message: "This trial was revoked." },
]) {
  test(`a shown track that polling finds inaccessible is replaced by the error screen (${story})`, async ({
    mount,
    page,
  }) => {
    await recordLoadingStates(page);
    const useWarnings = recordReactUseWarnings(page);
    const component = await mount(`routes/_shell.audiobooks.$conversionId/${story}`);
    await expect(
      component.getByRole("heading", { name: "A deterministic document about careful testing" }),
    ).toBeVisible();
    const recordedBefore = (await readLoadingStateRecord(page)).length;

    await expect(
      component.getByRole("heading", { name: "The track could not be loaded." }),
    ).toBeVisible();
    expect((await readLoadingStateRecord(page)).slice(recordedBefore)).toEqual([]);
    expect(useWarnings).toEqual([]);
    await expect(component.getByText(message)).toBeVisible();
    await expect(
      component.getByRole("heading", { name: "A deterministic document about careful testing" }),
    ).toHaveCount(0);
    await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
  });
}

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
