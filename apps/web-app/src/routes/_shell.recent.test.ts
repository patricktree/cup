import { expect, test, type Page } from "@playwright/test";

const ADDED_SOURCE_URL = "https://example.test/added";

for (const state of [
  {
    story: "routes/_shell.recent/EmptyRecents",
    text: "Your conversions will appear here.",
    name: "empty-recents",
  },
  {
    story: "routes/_shell.recent/Recents",
    text: "Open audiobook",
    name: "recents",
  },
]) {
  test(`renders ${state.name}`, async ({ mount }) => {
    const component = await mount(state.story);
    await expect(component.getByText(state.text, { exact: true })).toBeVisible();
    await expect(component).toHaveScreenshot(`${state.name}.png`);
  });
}

test("a signed-in home redirects to Recents", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/SignedInHome");
  await expect(component.getByRole("heading", { name: "Recents" })).toBeVisible();
  await expect(component.getByRole("textbox", { name: "URL" })).toHaveCount(0);
});

test("recents pagination appends a distinct page and removes Load more", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/Recents");
  await expect(component.getByRole("link", { name: "Open audiobook" })).toHaveCount(1);
  await component.getByRole("button", { name: "Load more" }).click();
  await expect(component.getByText("Another private audiobook", { exact: true })).toBeVisible();
  await expect(component.getByRole("link", { name: "Open audiobook" })).toHaveCount(2);
  await expect(component.getByRole("button", { name: "Load more" })).not.toBeVisible();
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
  await expect(
    component.getByText("Your conversions will appear here.", { exact: true }),
  ).toBeVisible();
  expect(requests).toBeGreaterThan(0);
  const settledRequests = requests;
  await page.clock.fastForward(16_000);
  expect(requests).toBe(settledRequests);
});

test("renders the idle Add dialog over Recents", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialog");
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recents", includeHidden: true })).toBeAttached();
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
    await component.getByRole("link", { name: "Add a track" }).click();
    await expect(page.getByRole("dialog", { name: "Add a track" })).toBeVisible();
    await close.run(page);
    await expect(page.getByRole("dialog", { name: "Add a track" })).toHaveCount(0);
    await expect(component.getByRole("heading", { name: "Recents" })).toBeVisible();
    // Opening again proves closing went back to the entry below, not forward to a new one.
    await component.getByRole("link", { name: "Add a track" }).click();
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
  await expect(component.getByRole("heading", { name: "Recents" })).toBeVisible();
});

test("a successful start closes the Add dialog and lists the new item", async ({ mount, page }) => {
  const component = await mount("routes/_shell.recent/AddDialogStarts");
  await expect(
    component.getByText("Your conversions will appear here.", { exact: true }),
  ).toBeVisible();
  await component.getByRole("link", { name: "Add a track" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a track" });
  await dialog.getByRole("textbox", { name: "URL" }).fill(ADDED_SOURCE_URL);
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(component.getByText(ADDED_SOURCE_URL, { exact: true })).toBeVisible();
});
