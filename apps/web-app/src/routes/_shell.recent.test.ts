import { expect, test, type Locator, type Page } from "@playwright/test";

const ADDED_SOURCE_URL = "https://example.test/added";
/** Cards on the first page of the `Recents` story. */
const FIRST_PAGE_SIZE = 24;

for (const state of [
  { story: "EmptyRecents", name: "empty-recents", cards: 0 },
  { story: "Recents", name: "recents", cards: FIRST_PAGE_SIZE },
  { story: "RecentsWithOneReadyItem", name: "recents-one-ready-item", cards: 1 },
  { story: "RecentsWithPendingAndFailed", name: "recents-pending-and-failed", cards: 5 },
  { story: "RecentsWithMiniPlayer", name: "recents-with-mini-player", cards: 1 },
]) {
  test(`renders ${state.name}`, async ({ mount, page }) => {
    const component = await mount(`routes/_shell.recent/${state.story}`);
    await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
    if (state.cards === 0) {
      await expect(component.getByRole("link", { name: "Add your first track" })).toBeVisible();
    } else {
      await expect(cardsOf(component)).toHaveCount(state.cards);
    }
    await expectCoversLoaded(page);
    await expect(component).toHaveScreenshot(`${state.name}.png`);
  });
}

test("a ready card links to its detail view and shows its title, cover and host", async ({
  mount,
}) => {
  const component = await mount("routes/_shell.recent/RecentsWithOneReadyItem");
  const card = cardsOf(component).first();
  const link = card.getByRole("link");

  await expect(link).toHaveAccessibleName(
    "Trump sieht sich als legitimer Träger von acht Nobelpreisen und wütet gegen Norwegen",
  );
  await expect(link).toHaveAttribute(
    "href",
    "/app/audiobooks/00000000-0000-4000-8000-000000000000",
  );
  // the cover is decorative: the title names the card
  await expect(link.locator("img")).toHaveAttribute("alt", "");
  await expect(card.getByText("derstandard.at", { exact: true })).toBeVisible();
  await expect(link.getByText("derstandard.at")).toHaveCount(0);
});

test("pending and failed cards show a muted line in the title slot and no cover", async ({
  mount,
}) => {
  const component = await mount("routes/_shell.recent/RecentsWithPendingAndFailed");
  const links = cardsOf(component).getByRole("link");

  await expect(links.nth(0)).toHaveAccessibleName("Selecting narration content");
  await expect(links.nth(1)).toHaveAccessibleName("Preparing");
  await expect(links.nth(3)).toHaveAccessibleName("Couldn't prepare this track");
  // a conversion with a narration document looks ready
  await expect(links.nth(4)).toHaveAccessibleName("Generating audio still looks ready");
  for (const index of [0, 1, 3]) {
    await expect(links.nth(index).locator("img")).toHaveCount(0);
  }
  // the source host shows only below the card, here "www." dropped
  await expect(cardsOf(component).nth(1).getByText("theverge.com", { exact: true })).toBeVisible();
});

test("the masonry keeps newest-first order left to right, top down", async ({ mount, page }) => {
  const component = await mount("routes/_shell.recent/Recents");
  await expect(cardsOf(component)).toHaveCount(FIRST_PAGE_SIZE);
  await expectCoversLoaded(page);

  const boxes = await readCardBoxes(component);
  const columnLefts = [...new Set(boxes.map((box) => box.left))].sort((a, b) => a - b);
  expect(columnLefts.length).toBeGreaterThanOrEqual(2);
  // the first row fills the columns left to right
  for (const [column, left] of columnLefts.entries()) {
    expect(boxes[column]).toMatchObject({ left, top: 0 });
  }
  // every later card goes into the column that ends highest, leftmost on a tie, so no card starts above its predecessor
  const columnBottoms = columnLefts.map(() => 0);
  for (const [index, box] of boxes.entries()) {
    const shortestColumn = columnBottoms.indexOf(Math.min(...columnBottoms));
    expect(box.left, `card ${index}`).toBe(columnLefts[shortestColumn]);
    expect(box.top, `card ${index}`).toBeGreaterThanOrEqual(boxes[index - 1]?.top ?? 0);
    columnBottoms[shortestColumn] = box.top + box.height;
  }
});

test("scrolling to the end loads the next page without moving existing cards", async ({
  mount,
  page,
}) => {
  let nextPageRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).searchParams.has("cursor")) {
      nextPageRequests += 1;
    }
  });
  const component = await mount("routes/_shell.recent/Recents");
  await expect(cardsOf(component)).toHaveCount(FIRST_PAGE_SIZE);
  await expectCoversLoaded(page);
  await expect(component.getByRole("button", { name: "Load more" })).toHaveCount(0);
  const firstPageBoxes = await readCardBoxes(component);

  // the first page is longer than the sentinel's margin, so the next page waits for scrolling
  expect(nextPageRequests).toBe(0);
  await component.getByRole("main").evaluate((main) => main.scrollTo({ top: main.scrollHeight }));

  await expect(cardsOf(component)).toHaveCount(FIRST_PAGE_SIZE + 12);
  await expectCoversLoaded(page);
  expect((await readCardBoxes(component)).slice(0, FIRST_PAGE_SIZE)).toEqual(firstPageBoxes);
});

for (const state of [
  { story: "RecentsWithMiniPlayer", name: "mini-player" },
  { story: "RecentsWithMiniPlayerWithoutCover", name: "mini-player-without-cover" },
]) {
  test(`renders the ${state.name}, paused and playing`, async ({ mount, page }) => {
    const component = await mount(`routes/_shell.recent/${state.story}`);
    const player = component.getByRole("region", { name: "Player" });
    await expectCoversLoaded(page);

    await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(player).toHaveScreenshot(`${state.name}-paused.png`);

    await player.getByRole("button", { name: "Play", exact: true }).click();
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(player).toHaveScreenshot(`${state.name}-playing.png`);
  });
}

test("the mini player names the loaded audiobook and its host", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/RecentsWithMiniPlayer");
  const player = component.getByRole("region", { name: "Player" });

  await expect(player.getByRole("link")).toHaveAccessibleName(
    "Sure, let’s smoosh SpaceX and xAI together theverge.com",
  );
  // the cover is decorative: the link names the audiobook
  await expect(player.locator("img")).toHaveAttribute("alt", "");
  await expect(player.getByRole("progressbar")).toHaveCount(0);
});

test("the mini player's −15 s skips the narration track back 15 seconds", async ({
  mount,
  page,
}) => {
  await captureNarrationAudio(page);
  const component = await mount("routes/_shell.recent/RecentsWithMiniPlayer");
  const player = component.getByRole("region", { name: "Player" });

  await setNarrationAudioTime(page, 40);
  await player.getByRole("button", { name: "Back 15 seconds" }).click();
  await expect.poll(() => readNarrationAudioTime(page)).toBe(25);

  await player.getByRole("button", { name: "Back 15 seconds" }).click();
  await player.getByRole("button", { name: "Back 15 seconds" }).click();
  await expect.poll(() => readNarrationAudioTime(page)).toBe(0);
});

test("pressing the mini player outside its buttons opens the loaded audiobook's detail view", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent/RecentsWithMiniPlayer");
  const cover = component.getByRole("region", { name: "Player" }).locator("img");
  await expectCoversLoaded(page);

  const coverBox = await cover.boundingBox();
  expect(coverBox).not.toBeNull();
  await page.mouse.click(coverBox!.x + coverBox!.width / 2, coverBox!.y + coverBox!.height / 2);
  await expect(
    component.getByRole("heading", { name: "Sure, let’s smoosh SpaceX and xAI together" }),
  ).toBeVisible();
  // the detail view shows the player sheet, not the mini player
  await expect(component.getByRole("contentinfo", { name: "Player" })).toBeVisible();
  await expect(component.getByRole("region", { name: "Player" })).toHaveCount(0);
});

test("the mini player stays on the account page", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/RecentsWithMiniPlayer");

  await component.getByRole("link", { name: "Account" }).click();
  await expect(component.getByRole("heading", { name: "Account settings" })).toBeVisible();
  await expect(
    component
      .getByRole("region", { name: "Player" })
      .getByRole("link", { name: /^Sure, let’s smoosh SpaceX and xAI together/ }),
  ).toBeVisible();
});

test("a signed-in home redirects to Recents", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/SignedInHome");
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(component.getByRole("textbox", { name: "URL" })).toHaveCount(0);
});

test("a URL shared while signed in opens the Add dialog with it filled in and submits nothing", async ({
  mount,
  page,
}) => {
  const starts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") {
      starts.push(new URL(request.url()).pathname);
    }
  });
  await mount("routes/_shell.recent/EmptyRecents");
  // The native share plugins hand the URL to share intake, and a cold start then opens the app's
  // home. The gallery's own mount keeps this page, and with it the pending URL; the mount fixture
  // would load a new one.
  await page.evaluate(async (url) => {
    const modulePath = "/src/platform/share-intake.ts";
    const { receiveSharedUrl } = await import(modulePath);
    receiveSharedUrl(url, () => {});
    const mountInPage: unknown = Reflect.get(window, "mount");
    if (typeof mountInPage !== "function") {
      throw new TypeError("The component gallery exposes no mount function");
    }
    await Reflect.apply(mountInPage, window, [{ story: "routes/_shell.recent/SignedInHome" }]);
  }, ADDED_SOURCE_URL);

  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await expect(dialog.getByRole("textbox", { name: "URL" })).toHaveValue(ADDED_SOURCE_URL);
  await expect(dialog.getByRole("button", { name: "Add" })).toBeEnabled();
  expect(starts).not.toContain("/api/account/conversions");
});

test("the empty state's link opens the Add dialog", async ({ mount, page }) => {
  const component = await mount("routes/_shell.recent/EmptyRecents");
  await component.getByRole("link", { name: "Add your first track" }).click();
  await expect(page.getByRole("dialog", { name: "Add a track" })).toBeVisible();
});

test("does not poll settled empty recents", async ({ mount, page }) => {
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/account/conversions") {
      requests += 1;
    }
  });
  await page.clock.install();
  const component = await mount("routes/_shell.recent/EmptyRecents");
  await expect(component.getByRole("link", { name: "Add your first track" })).toBeVisible();
  expect(requests).toBeGreaterThan(0);
  const settledRequests = requests;
  await page.clock.fastForward(16_000);
  expect(requests).toBe(settledRequests);
});

test("renders the idle Add dialog over Recents", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialog");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent", exact: true, includeHidden: true }),
  ).toBeAttached();
  await expect(dialog.getByRole("textbox", { name: "URL" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Add" })).toBeDisabled();
  await expect(page).toHaveScreenshot("add-dialog-idle.png");
});

test("renders the Add dialog while the start is pending", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialogPending");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await expect(dialog.getByRole("button", { name: "Adding…" })).toBeDisabled();
  await expect(dialog.getByRole("textbox", { name: "URL" })).toHaveValue(ADDED_SOURCE_URL);
  await expect(page).toHaveScreenshot("add-dialog-pending.png");
});

test("renders a refused start inside the Add dialog", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialogError");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await expect(dialog.getByRole("alert")).toHaveText("This page cannot be converted.");
  await expect(dialog.getByRole("button", { name: "Add" })).toBeEnabled();
  // The submit button regains focus once re-enabled, with or without a focus ring; the field keeps it stable.
  await dialog.getByRole("textbox", { name: "URL" }).focus();
  await expect(page).toHaveScreenshot("add-dialog-error.png");
});

test("validates the source URL in the Add dialog before starting", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialog");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await dialog.getByRole("textbox", { name: "URL" }).fill("not a URL");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByRole("textbox", { name: "URL" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(dialog.getByRole("button", { name: "Add" })).toBeDisabled();
});

for (const close of [
  { name: "Cancel", run: (page: Page) => page.getByRole("button", { name: "Cancel" }).click() },
  { name: "Escape", run: (page: Page) => page.keyboard.press("Escape") },
  { name: "a press outside", run: (page: Page) => page.mouse.click(4, 4) },
]) {
  test(`${close.name} closes the Add dialog opened from Recents`, async ({ mount, page }) => {
    const component = await mount("routes/_shell.recent/EmptyRecents");
    await component.getByRole("link", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add a track" })).toBeVisible();
    await close.run(page);
    await expect(page.getByRole("dialog", { name: "Add a track" })).toHaveCount(0);
    await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
    // Opening again proves closing went back to the entry below, not forward to a new one.
    await component.getByRole("link", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add a track" })).toBeVisible();
  });
}

test("closing an Add dialog that was not opened from Recents shows Recents", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent/AddDialog");
  await expect(page.getByRole("textbox", { name: "URL" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add a track" })).toHaveCount(0);
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
});

test("a successful start closes the Add dialog and lists the new item", async ({ mount, page }) => {
  const component = await mount("routes/_shell.recent/AddDialogStarts");
  await expect(component.getByRole("link", { name: "Add your first track" })).toBeVisible();
  await component.getByRole("link", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await dialog.getByRole("textbox", { name: "URL" }).fill(ADDED_SOURCE_URL);
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(cardsOf(component).getByRole("link")).toHaveAccessibleName("Preparing");
  await expect(cardsOf(component).getByText("example.test", { exact: true })).toBeVisible();
});

/**
 * Keeps the player host's audio element reachable, which is never attached to the document (see
 * _shell.audiobooks.$conversionId.test.ts).
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

async function setNarrationAudioTime(page: Page, seconds: number) {
  await page.evaluate((value) => {
    if ("narrationAudio" in window && window.narrationAudio instanceof HTMLAudioElement) {
      window.narrationAudio.currentTime = value;
    }
  }, seconds);
  await expect.poll(() => readNarrationAudioTime(page)).toBe(seconds);
}

function readNarrationAudioTime(page: Page) {
  return page.evaluate(() => {
    const audio = "narrationAudio" in window ? window.narrationAudio : undefined;
    if (!(audio instanceof HTMLAudioElement)) {
      throw new Error("The player host created no audio element.");
    }
    return audio.currentTime;
  });
}

function cardsOf(component: Locator): Locator {
  return component.getByRole("list", { name: "Tracks" }).getByRole("listitem");
}

/** Each card's position and height in the list, independent of the scroll position. */
function readCardBoxes(component: Locator) {
  return cardsOf(component).evaluateAll((cards) =>
    cards.map((card) => {
      const listBox = card.parentElement?.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      if (!listBox) {
        throw new Error("A card sits outside its list.");
      }
      return {
        left: Math.round(box.left - listBox.left),
        top: Math.round(box.top - listBox.top),
        height: Math.round(box.height),
      };
    }),
  );
}

/** Covers keep their placeholder until loaded; screenshots and layout checks wait for them. */
async function expectCoversLoaded(page: Page) {
  await expect
    .poll(() =>
      page
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              !image.hasAttribute("data-loading"),
          ),
        ),
    )
    .toBe(true);
}
