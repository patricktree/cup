import { expect, test, type Locator, type Page } from "@playwright/test";

import { readLoadingStateRecord, recordLoadingStates } from "@cup/loading-state-recorder";

import { failResponses, holdResponses, releaseResponses } from "#src/test-utils/held-responses.ts";
import { recordReactUseWarnings } from "#src/test-utils/react-use-warnings.ts";
import {
  readViewTransitionRecord,
  recordViewTransitions,
} from "#src/test-utils/view-transition-recorder.ts";

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
    await expect(page).toHaveScreenshot(`${state.name}.png`);
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

test("a card preloads its track only once no dialog covers it", async ({ mount, page }) => {
  const preloads: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/audiobooks/")) {
      preloads.push(pathname);
    }
  });
  await mount("routes/_shell.recent/OneReadyItemBehindAccountDialog");
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(dialog.getByText("Delete account…")).toBeVisible();
  await expectCoversLoaded(page);
  // The longest a preload takes to start, as nothing on the page tells that none will.
  await page.waitForTimeout(500);
  expect(preloads).toEqual([]);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => preloads)
    .toEqual(["/api/audiobooks/00000000-0000-4000-8000-000000000000"]);
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
  await component.getByRole("main").evaluate((main) => main.scrollIntoView({ block: "end" }));

  await expect(cardsOf(component)).toHaveCount(FIRST_PAGE_SIZE + 12);
  await expectCoversLoaded(page);
  expect((await readCardBoxes(component)).slice(0, FIRST_PAGE_SIZE)).toEqual(firstPageBoxes);
});

test("Back from a track opened on a scrolled Recents returns to the same card", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent/Recents");
  await expect(cardsOf(component)).toHaveCount(FIRST_PAGE_SIZE);
  await expectCoversLoaded(page);
  // a card far enough down that Recents opening at the top would not show it
  const card = cardsOf(component).nth(FIRST_PAGE_SIZE - 4);
  await card.scrollIntoViewIfNeeded();
  const scrollPosition = await page.evaluate(() => window.scrollY);
  expect(scrollPosition).toBeGreaterThan(0);

  await card.getByRole("link").click();
  await expect(component.getByRole("region", { name: "Preparing track" })).toBeVisible();
  await component.getByRole("link", { name: "Back", exact: true }).click();

  await expect(cardsOf(component).nth(FIRST_PAGE_SIZE - 4)).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollPosition);
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

test("pressing the mini player's cover opens the loaded audiobook's detail view, the rest of the pill does not", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent/RecentsWithMiniPlayer");
  const player = component.getByRole("region", { name: "Player" });
  const cover = player.locator("img");
  await expectCoversLoaded(page);

  // the gap between the link and the −15 s button
  const linkBox = await player.getByRole("link").boundingBox();
  expect(linkBox).not.toBeNull();
  await page.mouse.click(linkBox!.x + linkBox!.width + 4, linkBox!.y + linkBox!.height / 2);
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(player).toBeVisible();

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

test("the mini player stays behind the account dialog", async ({ mount, page }) => {
  const component = await mount("routes/_shell.recent/RecentsWithMiniPlayer");

  await component.getByRole("link", { name: "Account" }).click();
  await expect(page.getByRole("dialog", { name: "Account settings" })).toBeVisible();
  // The open dialog hides the page behind it from the accessibility tree.
  await expect(
    page.getByRole("region", { name: "Player", includeHidden: true }).getByRole("link", {
      name: /^Sure, let’s smoosh SpaceX and xAI together/,
      includeHidden: true,
    }),
  ).toBeVisible();
});

test("a signed-in home redirects to Recents", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/SignedInHome");
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(component.getByRole("textbox", { name: "URL" })).toHaveCount(0);
});

test("a signed-in cold start on home never shows the start form before Recents", async ({
  mount,
  page,
}) => {
  // Records every text field the page inserts, however briefly; Recents itself has none.
  await page.addInitScript(() => {
    const insertedFields: string[] = [];
    Object.assign(window, { insertedFields });
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && (node.matches("input") || node.querySelector("input"))) {
            insertedFields.push(node.outerHTML);
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const authConfigRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/auth/config",
  );
  const component = await mount("routes/_shell.recent/SignedInColdStartHome");
  await authConfigRequest;
  // Gives the page a few frames to render what it shows while auth is held.
  await page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame++) {
      await new Promise(requestAnimationFrame);
    }
  });
  await releaseResponses(page, "auth-config");

  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "insertedFields"))).toEqual([]);
});

for (const path of ["SignedOutRecents", "SignedOutAddDialog", "SignedOutAccountDialog"]) {
  test(`a signed-out listener opening ${path} is sent home in place of that history entry`, async ({
    mount,
    page,
  }) => {
    const component = await mount(`routes/_shell.recent/${path}`);

    await expect(component.getByRole("heading", { name: "Just listen." })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const readLength: unknown = Reflect.get(window, "readAccountStoryHistoryLength");
        if (typeof readLength !== "function") {
          throw new TypeError("The account story offers no readAccountStoryHistoryLength");
        }
        return Reflect.apply(readLength, window, []);
      }),
    ).toBe(1);
  });
}

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
  // The field stays unfocused, so opening the sheet does not raise the on-screen keyboard.
  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole("textbox", { name: "URL" })).toHaveAttribute(
    "placeholder",
    "Paste website link (https://...)",
  );
  await expect(dialog.getByRole("button", { name: "Add" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(page).toHaveScreenshot("add-dialog-idle.png");
});

test("the Add dialog is a sheet along the bottom edge, inside the app column's gutter", async ({
  mount,
  page,
}) => {
  await mount("routes/_shell.recent/AddDialog");
  await waitForAddDialogAtRest(page);
  const box = await page.getByRole("dialog", { name: "Add a track" }).boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) {
    throw new Error("The Add dialog has no box, or the page no viewport size");
  }
  expect(box.y + box.height).toBe(viewport.height);
  // The 800 px app column, less the 12 px gutter on each side.
  const inset = Math.max(0, (viewport.width - 800) / 2) + 12;
  expect(box.x).toBe(inset);
  expect(box.x + box.width).toBe(viewport.width - inset);
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

test("a refused start in the Add dialog leaves nothing for home or a reopened dialog", async ({
  mount,
  page,
}) => {
  const starts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/conversions")) {
      starts.push(request.url());
    }
  });
  const component = await mount("routes/_shell.recent/AddDialogError");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await expect(dialog.getByRole("alert")).toHaveText("This page cannot be converted.");
  // The stored request belongs to the home page's start, which resumes it after sign-in.
  expect(await page.evaluate(() => window.sessionStorage.getItem("cup_pending_conversion"))).toBe(
    null,
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await component.getByRole("link", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "URL" })).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Add" })).toBeDisabled();
  expect(starts).toHaveLength(1);
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
  { name: "Close", run: (page: Page) => page.getByRole("button", { name: "Close" }).click() },
  { name: "Escape", run: (page: Page) => page.keyboard.press("Escape") },
  { name: "a press outside", run: (page: Page) => page.mouse.click(4, 4) },
  {
    name: "Pulling the grabber down",
    run: async (page: Page) => dragAddDialogGrabber(page, await readAddDialogTop(page), 200),
  },
]) {
  test(`${close.name} slides the Add dialog away and closes it, opened from Recents`, async ({
    mount,
    page,
  }) => {
    const component = await mount("routes/_shell.recent/EmptyRecents");
    await component.getByRole("link", { name: "Add", exact: true }).click();
    const restingTop = await waitForAddDialogAtRest(page);

    const closingTops = sampleAddDialogTops(page, "until-gone");
    await close.run(page);
    expectSlidAway(await closingTops, restingTop);

    await expect(page.getByRole("dialog", { name: "Add a track" })).toHaveCount(0);
    await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
    // Opening again proves closing went back to the entry below, not forward to a new one.
    await component.getByRole("link", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add a track" })).toBeVisible();
  });
}

test("a short pull on the Add dialog's grabber lets it settle back", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialog");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  const restingTop = await waitForAddDialogAtRest(page);

  const tops = sampleAddDialogTops(page, "until-rest-after-moving");
  await dragAddDialogGrabber(page, restingTop, 60);

  // It followed the pointer down, then came back up.
  expect(Math.max(...(await tops))).toBeGreaterThan(restingTop + 30);
  await expect(dialog).toBeVisible();
  await expect.poll(() => readAddDialogTop(page)).toBe(restingTop);
});

test("renders the Add dialog held partway down by a pull", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialog");
  const restingTop = await waitForAddDialogAtRest(page);
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("The page has no viewport size");
  }

  const x = viewport.width / 2;
  await page.mouse.move(x, restingTop + 8);
  await page.mouse.down();
  await page.mouse.move(x, restingTop + 108, { steps: 10 });
  // The dialog follows the pointer once the pull passes Base UI's small start threshold.
  await expect.poll(() => readAddDialogTop(page)).toBeGreaterThan(restingTop + 50);

  // The backdrop has faded by as much as the pull has moved the dialog down.
  await expect(page).toHaveScreenshot("add-dialog-mid-pull.png");
  await page.mouse.up();
});

test("a mouse drag inside the Add dialog's form leaves it in place", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialog");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  const restingTop = await waitForAddDialogAtRest(page);
  const field = await dialog.getByRole("textbox", { name: "URL" }).boundingBox();
  if (!field) {
    throw new Error("The URL field has no box");
  }

  const start = { x: field.x + field.width / 2, y: field.y + field.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 200, { steps: 10 });
  expect(await readAddDialogTop(page)).toBe(restingTop);
  await page.mouse.up();

  await expect(dialog).toBeVisible();
  expect(await readAddDialogTop(page)).toBe(restingTop);
});

test("the Add dialog slides up from the bottom edge as it opens", async ({ mount, page }) => {
  const component = await mount("routes/_shell.recent/EmptyRecents");
  await component.getByRole("link", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a track" })).toBeAttached();

  const openingTops = await sampleAddDialogTops(page, "until-rest");
  const restingTop = await readAddDialogTop(page);
  expect(new Set(openingTops).size).toBeGreaterThan(2);
  expect(openingTops[0]).toBeGreaterThan(restingTop);
  expect(isOrdered(openingTops, "descending")).toBe(true);
  expect(openingTops.at(-1)).toBe(restingTop);
});

test("with reduced motion, the Add dialog appears and leaves without sliding", async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const component = await mount("routes/_shell.recent/EmptyRecents");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await component.getByRole("link", { name: "Add", exact: true }).click();
  await expect(dialog).toBeAttached();

  const restingTop = await readAddDialogTop(page);
  expect(await sampleAddDialogTops(page, "until-rest")).toEqual([restingTop]);

  await page.keyboard.press("Escape");
  // It may stay for a frame before it leaves, but it never moves across frames.
  expect((await sampleAddDialogTops(page, "until-rest")).length).toBeLessThanOrEqual(1);
  await expect(dialog).toHaveCount(0);
});

test("a start that succeeds after Back closed the Add dialog leaves the listener where they went", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent/AddDialogStartsLater");
  await component.getByRole("link", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await dialog.getByRole("textbox", { name: "URL" }).fill(ADDED_SOURCE_URL);
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByRole("button", { name: "Adding…" })).toBeVisible();

  await page.evaluate(() => {
    const goBack: unknown = Reflect.get(window, "goBackInAccountStory");
    if (typeof goBack !== "function") {
      throw new TypeError("The account story offers no Back");
    }
    Reflect.apply(goBack, window, []);
  });
  await expect(dialog).toHaveCount(0);
  await component.getByRole("link", { name: "Account", exact: true }).click();
  const accountDialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(accountDialog.getByText("Delete account…")).toBeVisible();

  // A successful start refreshes the account, then reports that the dialog's start succeeded.
  const accountRefresh = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/account",
  );
  await page.evaluate(() => {
    const answer: unknown = Reflect.get(window, "answerAddDialogStart");
    if (typeof answer !== "function") {
      throw new TypeError("The start request is not waiting");
    }
    Reflect.apply(answer, window, []);
  });
  await accountRefresh;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  // The Add dialog is no longer shown, so its late success neither goes back nor closes this one.
  await expect(accountDialog.getByText("Delete account…")).toBeVisible();
});

test("closing an Add dialog that was not opened from Recents shows Recents", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent/AddDialog");
  await expect(page.getByRole("dialog", { name: "Add a track" })).toBeFocused();
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
  const restingTop = await waitForAddDialogAtRest(page);
  const closingTops = sampleAddDialogTops(page, "until-gone");
  await dialog.getByRole("button", { name: "Add" }).click();
  expectSlidAway(await closingTops, restingTop);
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

test("the tracks still loading are marked as a loading state", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/LoadingTracks");

  await expect(component.getByText("Loading tracks…")).toHaveAttribute("data-loading-state", "");
});

const REVISITED_READY_TITLE =
  "Trump sieht sich als legitimer Träger von acht Nobelpreisen und wütet gegen Norwegen";
const REVISITED_READY_ID = "00000000-0000-4000-8000-000000000000";
const REVISITED_PENDING_ID = "00000000-0000-4000-8000-000000000001";

/** The loading states recorded after the first `skippedCount`, those of the visit under test. */
async function readLoadingStatesSince(page: Page, skippedCount: number) {
  return (await readLoadingStateRecord(page)).slice(skippedCount);
}

/**
 * Stays away from a screen longer than Query keeps an unobserved query at the least (one second for
 * a suspense query), so a cache that does not keep it for the page lifetime has dropped it. Needs
 * `page.clock.install()` before the mount.
 */
async function stayAway(page: Page) {
  await page.clock.fastForward(5_000);
}

test("going back from a detail view shows Recents' cached cards while its history is requested again", async ({
  mount,
  page,
}) => {
  await recordLoadingStates(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expect(cardsOf(component)).toHaveCount(2);
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByRole("heading", { name: REVISITED_READY_TITLE })).toBeVisible();

  await holdResponses(page, "account-history");
  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await component.getByRole("link", { name: "Back", exact: true }).click();

  await expect(cardsOf(component)).toHaveCount(2);
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);
  await releaseResponses(page, "account-history");
});

test("returning to Recents from a screen that does not show the history shows its cached cards", async ({
  mount,
  page,
}) => {
  await recordLoadingStates(page);
  await page.clock.install();
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expect(cardsOf(component)).toHaveCount(2);
  // Unlike the detail view, which observes the history to offer deletion, account recovery leaves
  // it unobserved, so only the cache lifetime keeps it while the listener is away.
  await openPathInAccountStory(page, "/account-recovery");
  await expect(component.getByText("This account is not scheduled for deletion.")).toBeVisible();
  await stayAway(page);

  await holdResponses(page, "account-history");
  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await component.getByRole("link", { name: "Go to Recent" }).click();

  await expect(cardsOf(component)).toHaveCount(2);
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);
  await releaseResponses(page, "account-history");
});

test("reopening a track shows its cached content while the audiobook is requested again", async ({
  mount,
  page,
}) => {
  await recordLoadingStates(page);
  await page.clock.install();
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByText("Two.", { exact: true })).toBeVisible();
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);
  await stayAway(page);

  await holdResponses(page, `audiobook:${REVISITED_READY_ID}`);
  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();

  await expect(component.getByText("Two.", { exact: true })).toBeVisible();
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);
  await releaseResponses(page, `audiobook:${REVISITED_READY_ID}`);
});

test("reopening a track still being prepared shows it preparing, not as a failure", async ({
  mount,
  page,
}) => {
  await recordLoadingStates(page);
  await page.clock.install();
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  const preparingTrack = component.getByLabel("Preparing track", { exact: true });
  await cardsOf(component).getByRole("link", { name: "Preparing", exact: true }).click();
  await expect(preparingTrack).toBeVisible();
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);
  await stayAway(page);

  await holdResponses(page, `audiobook:${REVISITED_PENDING_ID}`);
  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await cardsOf(component).getByRole("link", { name: "Preparing", exact: true }).click();

  await expect(preparingTrack).toBeVisible();
  await expect(component.getByRole("alert")).toHaveCount(0);
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);
  await releaseResponses(page, `audiobook:${REVISITED_PENDING_ID}`);
});

for (const { status, message } of [
  { status: 404, message: "Not found." },
  { status: 403, message: "This trial was revoked." },
] as const) {
  test(`reopening a track whose refetch answers ${status} replaces its cached content by the error screen`, async ({
    mount,
    page,
  }) => {
    const useWarnings = recordReactUseWarnings(page);
    await page.clock.install();
    const component = await mount("routes/_shell.recent/RevisitingScreens");
    await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
    await expect(component.getByText("Two.", { exact: true })).toBeVisible();
    await component.getByRole("link", { name: "Back", exact: true }).click();
    await expect(cardsOf(component)).toHaveCount(2);
    await stayAway(page);

    await failResponses(page, `audiobook:${REVISITED_READY_ID}`, status);
    await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();

    await expect(
      component.getByRole("heading", { name: "The track could not be loaded." }),
    ).toBeVisible();
    await expect(component.getByText(message)).toBeVisible();
    await expect(component.getByText("Two.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
    expect(useWarnings).toEqual([]);
  });

  test(`returning to Recents whose refetch answers ${status} replaces its cached cards by the error screen`, async ({
    mount,
    page,
  }) => {
    const useWarnings = recordReactUseWarnings(page);
    await page.clock.install();
    const component = await mount("routes/_shell.recent/RevisitingScreens");
    await expect(cardsOf(component)).toHaveCount(2);
    await openPathInAccountStory(page, "/account-recovery");
    await expect(component.getByText("This account is not scheduled for deletion.")).toBeVisible();
    await stayAway(page);

    await failResponses(page, "account-history", status);
    await component.getByRole("link", { name: "Go to Recent" }).click();

    await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(component.getByText(message)).toBeVisible();
    await expect(cardsOf(component)).toHaveCount(0);
    await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
    expect(useWarnings).toEqual([]);
  });
}

test("reopening a track whose refetch fails on the server keeps its cached content and shows a toast", async ({
  mount,
  page,
}) => {
  await page.clock.install();
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByText("Two.", { exact: true })).toBeVisible();
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);
  await stayAway(page);

  await failResponses(page, `audiobook:${REVISITED_READY_ID}`, 500);
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();

  const toasts = page.getByRole("alertdialog", { includeHidden: true });
  await expect(toasts).toContainText("The track could not be updated.");
  await expect(toasts).toHaveCount(1);
  await expect(component.getByText("Two.", { exact: true })).toBeVisible();
});

test("returning to Recents whose refetch fails on the server keeps its cached cards and shows a toast", async ({
  mount,
  page,
}) => {
  await page.clock.install();
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expect(cardsOf(component)).toHaveCount(2);
  await openPathInAccountStory(page, "/account-recovery");
  await expect(component.getByText("This account is not scheduled for deletion.")).toBeVisible();
  await stayAway(page);

  await failResponses(page, "account-history", 500);
  await component.getByRole("link", { name: "Go to Recent" }).click();

  const toasts = page.getByRole("alertdialog", { includeHidden: true });
  await expect(toasts).toContainText("Your tracks could not be updated.");
  await expect(toasts).toHaveCount(1);
  await expect(cardsOf(component)).toHaveCount(2);
});

test("reopening the account dialog shows the cached account while it is requested again", async ({
  mount,
  page,
}) => {
  await recordLoadingStates(page);
  await page.clock.install();
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await component.getByRole("link", { name: "Account", exact: true }).click();
  await expect(dialog.getByText("Delete account…", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await stayAway(page);

  await holdResponses(page, "account");
  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await component.getByRole("link", { name: "Account", exact: true }).click();

  await expect(dialog.getByText("Delete account…", { exact: true })).toBeVisible();
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);
  await releaseResponses(page, "account");
});

test("reopening the Add dialog shows it at once", async ({ mount, page }) => {
  await recordLoadingStates(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await component.getByRole("link", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "URL" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await component.getByRole("link", { name: "Add", exact: true }).click();

  await expect(dialog.getByRole("textbox", { name: "URL" })).toBeVisible();
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);
});

test("a first visit to a track holds Recents behind the progress bar, then shows the skeleton for at least 300 ms", async ({
  mount,
  page,
}) => {
  await recordLoadingStates(page);
  await page.clock.install();
  const component = await mount("routes/_shell.recent/FirstVisitToHeldTrack");
  await expect(cardsOf(component)).toHaveCount(2);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  const progressBar = page.getByRole("progressbar", { name: "Loading" });
  const trackSkeleton = component.getByLabel("Loading track", { exact: true });

  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();

  await page.clock.runFor(99);
  await expect(cardsOf(component)).toHaveCount(2);
  await expect(progressBar).toHaveCount(0);
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);

  await page.clock.runFor(1);
  await expect(progressBar).toBeVisible();
  await expect(progressBar).toHaveAttribute("data-pending-signal", "");

  await page.clock.runFor(399);
  await expect(cardsOf(component)).toHaveCount(2);
  await expect(trackSkeleton).toHaveCount(0);

  await page.clock.runFor(1);
  await expect(trackSkeleton).toBeVisible();

  const audiobookResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/audiobooks/${REVISITED_READY_ID}`,
  );
  await releaseResponses(page, `audiobook:${REVISITED_READY_ID}`);
  await audiobookResponse;
  // A paused clock also holds Query's notifications, so the response shows only as time passes.
  await page.clock.runFor(299);
  await expect(trackSkeleton).toBeVisible();

  await page.clock.runFor(1);
  await expect(component.getByText("Two.", { exact: true })).toBeVisible();
  await expect(progressBar).toHaveCount(0);
  expect(
    (await readLoadingStatesSince(page, recordedBefore)).map(({ marker, name }) => ({
      marker,
      name,
    })),
  ).toEqual([
    { marker: "data-pending-signal", name: "Loading" },
    { marker: "data-loading-state", name: "Loading track" },
  ]);
});

test("a card in view preloads its track, so opening it shows no loading state", async ({
  mount,
  page,
}) => {
  const requestedPaths = new Set<string>();
  page.on("request", (request) => requestedPaths.add(new URL(request.url()).pathname));
  await recordLoadingStates(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expect(cardsOf(component)).toHaveCount(2);

  await expect.poll(() => requestedPaths.has(`/api/audiobooks/${REVISITED_READY_ID}`)).toBe(true);
  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();

  await expect(component.getByText("Two.", { exact: true })).toBeVisible();
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);
});

test("a preloaded track shows no progress bar while the browser captures its cover transition", async ({
  mount,
  page,
}) => {
  // WebKit in the E2E suite's Docker browser takes longer than the bar's delay to capture the old
  // screen; delaying the transition's update stands in for that, in any browser.
  await page.addInitScript(() => {
    const startViewTransition = document.startViewTransition.bind(document);
    document.startViewTransition = (options) => {
      const update = typeof options === "function" ? options : options?.update;
      const delayedUpdate = async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await update?.();
      };
      return startViewTransition(
        typeof options === "function" || options === undefined
          ? delayedUpdate
          : { ...options, update: delayedUpdate },
      );
    };
  });
  const requestedPaths = new Set<string>();
  page.on("request", (request) => requestedPaths.add(new URL(request.url()).pathname));
  await recordLoadingStates(page);
  await recordViewTransitions(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expectCoversLoaded(page);
  await expect.poll(() => requestedPaths.has(`/api/audiobooks/${REVISITED_READY_ID}`)).toBe(true);

  const recordedBefore = (await readLoadingStateRecord(page)).length;
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();

  await expect(component.getByText("Two.", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await readViewTransitionRecord(page)).map(({ types }) => types))
    .toEqual([["track-cover"]]);
  expect(await readLoadingStatesSince(page, recordedBefore)).toEqual([]);
});

test("leaving a track being prepared stops polling it, and reopening it polls again", async ({
  mount,
  page,
}) => {
  let audiobookRequestCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/audiobooks/${REVISITED_PENDING_ID}`) {
      audiobookRequestCount += 1;
    }
  });
  await page.clock.install();
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await cardsOf(component).getByRole("link", { name: "Preparing", exact: true }).click();
  await expect(component.getByLabel("Preparing track", { exact: true })).toBeVisible();
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);

  const requestCountOnLeaving = audiobookRequestCount;
  await page.clock.fastForward(10_000);
  expect(audiobookRequestCount).toBe(requestCountOnLeaving);

  await cardsOf(component).getByRole("link", { name: "Preparing", exact: true }).click();
  await expect.poll(() => audiobookRequestCount).toBe(requestCountOnLeaving + 1);
  await page.clock.fastForward(2_000);
  await expect.poll(() => audiobookRequestCount).toBeGreaterThan(requestCountOnLeaving + 1);
});

test("opening a track from Recents and going back runs the cover transition between the card and the detail view", async ({
  mount,
  page,
}) => {
  await recordViewTransitions(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expectCoversLoaded(page);

  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByRole("heading", { name: REVISITED_READY_TITLE })).toBeVisible();
  await loadIntoPlayer(component);
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);

  await expect
    .poll(() => readViewTransitionRecord(page))
    .toEqual([
      {
        types: ["track-cover"],
        oldCovers: ["card"],
        newCovers: ["detail"],
        bottomBarGap: 0,
        isNamedBottomBarSticky: false,
        isBottomBarAboveCover: true,
        isBottomBarPair: true,
        fadingScreens: ["detail-header", "detail-screen", "recents-screen"],
        isDocumentCaptured: false,
      },
      {
        types: ["track-cover"],
        oldCovers: ["detail"],
        newCovers: ["card"],
        bottomBarGap: 0,
        isNamedBottomBarSticky: false,
        isBottomBarAboveCover: true,
        isBottomBarPair: true,
        fadingScreens: ["detail-header", "detail-screen", "recents-screen"],
        isDocumentCaptured: false,
      },
    ]);
});

test("going back from a detail view scrolled past its cover only cross-fades", async ({
  mount,
  page,
}) => {
  await recordViewTransitions(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expectCoversLoaded(page);
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByRole("heading", { name: REVISITED_READY_TITLE })).toBeVisible();
  await expect.poll(async () => (await readViewTransitionRecord(page)).length).toBe(1);
  await page.evaluate(() => document.activeViewTransition?.finished);

  await scrollCoverTo(page, "above-viewport");
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);

  await expect
    .poll(async () => (await readViewTransitionRecord(page)).at(-1))
    .toMatchObject({ types: ["screen-fade"], oldCovers: [], newCovers: [] });
});

test("going back from a detail view with its cover partly in view moves the cover", async ({
  mount,
  page,
}) => {
  await recordViewTransitions(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expectCoversLoaded(page);
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByRole("heading", { name: REVISITED_READY_TITLE })).toBeVisible();
  await expect.poll(async () => (await readViewTransitionRecord(page)).length).toBe(1);
  await page.evaluate(() => document.activeViewTransition?.finished);

  await scrollCoverTo(page, "partly-in-viewport");
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);

  await expect
    .poll(async () => (await readViewTransitionRecord(page)).at(-1))
    .toMatchObject({ types: ["track-cover"], oldCovers: ["detail"], newCovers: ["card"] });
});

test("opening a track from Recents scrolled past its card only cross-fades", async ({
  mount,
  page,
}) => {
  await recordViewTransitions(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expectCoversLoaded(page);
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByRole("heading", { name: REVISITED_READY_TITLE })).toBeVisible();
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);
  await expect.poll(async () => (await readViewTransitionRecord(page)).length).toBe(2);
  await page.evaluate(() => document.activeViewTransition?.finished);

  await scrollCoverTo(page, "above-viewport");
  // Not a tap on the card, as that would scroll it into view: the way a browser Forward opens it.
  await openPathInAccountStory(page, `/audiobooks/${REVISITED_READY_ID}`);
  await expect(component.getByRole("heading", { name: REVISITED_READY_TITLE })).toBeVisible();

  await expect
    .poll(async () => (await readViewTransitionRecord(page)).at(-1))
    .toMatchObject({ types: ["screen-fade"], oldCovers: [], newCovers: [] });
  expect(await readViewTransitionRecord(page)).toHaveLength(3);
});

test("opening a track from the mini player and going back only cross-fade, even with its card in view", async ({
  mount,
  page,
}) => {
  await recordViewTransitions(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");
  await expectCoversLoaded(page);
  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByRole("heading", { name: REVISITED_READY_TITLE })).toBeVisible();
  await loadIntoPlayer(component);
  await component.getByRole("link", { name: "Back", exact: true }).click();
  const player = component.getByRole("region", { name: "Player" });
  await expect(player).toBeVisible();
  await expect.poll(async () => (await readViewTransitionRecord(page)).length).toBe(2);
  await page.evaluate(() => document.activeViewTransition?.finished);

  await player.getByRole("link").click();

  await expect
    .poll(async () => (await readViewTransitionRecord(page)).at(-1))
    .toEqual({
      types: ["screen-fade"],
      oldCovers: [],
      newCovers: [],
      bottomBarGap: 0,
      isNamedBottomBarSticky: false,
      isBottomBarAboveCover: true,
      isBottomBarPair: true,
      fadingScreens: ["detail-header", "detail-screen", "recents-screen"],
      isDocumentCaptured: false,
    });
  expect(await readViewTransitionRecord(page)).toHaveLength(3);
  await page.evaluate(() => document.activeViewTransition?.finished);

  // the detail view's cover is in view, and so is the card it would land on
  await component.getByRole("link", { name: "Back", exact: true }).click();

  await expect(cardsOf(component)).toHaveCount(2);
  await expect.poll(async () => (await readViewTransitionRecord(page)).length).toBe(4);
  expect((await readViewTransitionRecord(page)).at(-1)).toMatchObject({
    types: ["screen-fade"],
    oldCovers: [],
    newCovers: [],
  });
});

test("with reduced motion, opening a track and going back start no view transition", async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordViewTransitions(page);
  const component = await mount("routes/_shell.recent/RevisitingScreens");

  await cardsOf(component).getByRole("link", { name: REVISITED_READY_TITLE }).click();
  await expect(component.getByRole("heading", { name: REVISITED_READY_TITLE })).toBeVisible();
  await component.getByRole("link", { name: "Back", exact: true }).click();
  await expect(cardsOf(component)).toHaveCount(2);

  await page.evaluate(() => document.activeViewTransition?.finished);
  expect(await readViewTransitionRecord(page)).toEqual([]);
});

/** Waits until the Add dialog has slid in and stopped moving, and returns its top edge. */
async function waitForAddDialogAtRest(page: Page): Promise<number> {
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  return readAddDialogTop(page);
}

/**
 * Reads the Add dialog's top edge on every frame, for at most 5 s:
 *
 * - `until-rest`: while it moves, until it rests or leaves the document; a dialog that does not move
 *   yields only its first top, one already gone none.
 * - `until-rest-after-moving`: as `until-rest`, but first waits for it to start moving.
 * - `until-gone`: until it leaves the document, also while it rests before.
 */
function sampleAddDialogTops(
  page: Page,
  stop: "until-rest" | "until-rest-after-moving" | "until-gone",
): Promise<number[]> {
  return page.evaluate(
    (stopAt) =>
      new Promise<number[]>((resolve) => {
        const tops: number[] = [];
        const deadline = performance.now() + 5000;
        let hasMoved = false;
        const sample = () => {
          const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
            (element) =>
              document.getElementById(element.getAttribute("aria-labelledby") ?? "")
                ?.textContent === "Add a track",
          );
          if (dialog === undefined) {
            resolve(tops);
            return;
          }
          const top = dialog.getBoundingClientRect().top;
          hasMoved ||= tops.length > 0 && top !== tops.at(-1);
          tops.push(top);
          const isResting =
            dialog.getAnimations().length === 0 && !dialog.hasAttribute("data-swiping");
          const isDone =
            (stopAt === "until-rest" && isResting) ||
            (stopAt === "until-rest-after-moving" && isResting && hasMoved);
          if (isDone || performance.now() > deadline) {
            resolve(tops);
            return;
          }
          requestAnimationFrame(sample);
        };
        sample();
      }),
    stop,
  );
}

/** Expects the dialog's top edge to have moved down through several frames, off its resting place. */
function expectSlidAway(tops: number[], restingTop: number) {
  expect(new Set(tops).size).toBeGreaterThan(2);
  expect(isOrdered(tops, "ascending"), `top edges ${JSON.stringify(tops)}`).toBe(true);
  expect(tops.at(-1)).toBeGreaterThan(restingTop);
}

function isOrdered(values: number[], order: "ascending" | "descending"): boolean {
  return values.every((value, index) => {
    const previous = values[index - 1];
    if (previous === undefined) {
      return true;
    }
    return order === "ascending" ? value >= previous : value <= previous;
  });
}

async function readAddDialogTop(page: Page): Promise<number> {
  const box = await page.getByRole("dialog", { name: "Add a track" }).boundingBox();
  if (!box) {
    throw new Error("The Add dialog has no box");
  }
  return box.y;
}

/**
 * Drags the Add dialog down by its grabber, which sits centered on its top edge, and holds still
 * before letting go, so the pull ends slowly rather than as a flick.
 */
async function dragAddDialogGrabber(page: Page, dialogTop: number, distance: number) {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("The page has no viewport size");
  }
  const x = viewport.width / 2;
  const y = dialogTop + 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + distance, { steps: 10 });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  await page.mouse.up();
}

/** Scrolls the shown screen's track cover, on a page made tall enough for any story's content. */
async function scrollCoverTo(page: Page, place: "above-viewport" | "partly-in-viewport") {
  await page.evaluate((coverPlace) => {
    document.body.style.minHeight = "500vh";

    const cover = document.querySelector("[data-track-cover]");
    if (cover === null) {
      throw new TypeError("The shown screen has no track cover");
    }
    const { top, height } = cover.getBoundingClientRect();
    window.scrollTo({
      top: window.scrollY + top + (coverPlace === "above-viewport" ? height + 1 : height / 2),
      behavior: "instant",
    });
  }, place);
}

async function openPathInAccountStory(page: Page, path: string) {
  await page.evaluate((pathToOpen) => {
    const openPath: unknown = Reflect.get(window, "openPathInAccountStory");
    if (typeof openPath !== "function") {
      throw new TypeError("The account story cannot open a path");
    }
    Reflect.apply(openPath, window, [pathToOpen]);
  }, path);
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

test("the page title names Recent, and the Add dialog while it is open", async ({
  mount,
  page,
}) => {
  await mount("routes/_shell.recent/AddDialog");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveTitle("Add · Cup");

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveTitle("Recent · Cup");
});

test("the page title names the account dialog while it is open", async ({ mount, page }) => {
  await mount("routes/_shell.recent/OneReadyItemBehindAccountDialog");
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(dialog.getByText("Delete account…")).toBeVisible();
  await expect(page).toHaveTitle("Account · Cup");

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveTitle("Recent · Cup");
});

test("the page title names Recent while its tracks load", async ({ mount, page }) => {
  const component = await mount("routes/_shell.recent/LoadingTracks");
  await expect(component.getByText("Loading tracks…")).toBeVisible();
  await expect(page).toHaveTitle("Recent · Cup");
});

/** Plays and pauses the shown track, so Recents shows it in the mini player. */
async function loadIntoPlayer(component: Locator): Promise<void> {
  const playerSheet = component.getByRole("contentinfo", { name: "Player" });
  await playerSheet.getByRole("button", { name: "Play", exact: true }).click();
  await playerSheet.getByRole("button", { name: "Pause", exact: true }).click();
}
