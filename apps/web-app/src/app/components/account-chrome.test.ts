import { expect, test } from "@playwright/test";

test("the tab bar on Recents marks Recent as the current tab", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/EmptyRecents");
  const tabs = component.getByRole("navigation", { name: "Tabs" });

  await expect(tabs.getByRole("link", { name: "Recent" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Add" })).not.toHaveAttribute("aria-current");
  await expect(tabs).toHaveScreenshot("tab-bar-recent.png");
});

test("Add never shows as current, even with the Add dialog open", async ({ mount, page }) => {
  await mount("routes/_shell.recent/AddDialog");
  await expect(page.getByRole("dialog", { name: "Add a track" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Tabs", includeHidden: true });

  await expect(tabs.getByRole("link", { name: "Add", includeHidden: true })).not.toHaveAttribute(
    "aria-current",
  );
  await expect(tabs.getByRole("link", { name: "Recent", includeHidden: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

for (const story of [
  "routes/index/SignIn",
  "routes/trials.$grantId/OpenGrant",
  "routes/_shell.audiobooks.$conversionId/ReadyAudiobook",
]) {
  test(`${story} shows no tab bar`, async ({ mount, page }) => {
    await mount(story);
    // Some of these pages open a dialog, which hides the page behind it from the accessibility tree.
    await expect(page.getByRole("heading", { includeHidden: true }).first()).toBeVisible();

    await expect(page.getByRole("navigation", { name: "Tabs", includeHidden: true })).toHaveCount(
      0,
    );
  });
}

test("the avatar shows the account holder's initials and opens the account dialog", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent/EmptyRecents");
  const avatar = component.getByRole("link", { name: "Account" });

  await expect(avatar).toHaveText("vh", { useInnerText: true });
  await expect(avatar).toHaveScreenshot("avatar-initials.png");
  await avatar.click();
  await expect(page.getByRole("dialog", { name: "Account settings" })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Account settings" })).toHaveCount(0);
  await expect(avatar).toBeVisible();
});

test("the avatar shows a glyph when the session carries no name", async ({ mount }) => {
  const component = await mount("routes/_shell.recent/RecentsWithoutName");
  const avatar = component.getByRole("link", { name: "Account" });

  await expect(avatar).toHaveText("");
  await expect(avatar.locator("svg")).toHaveCount(2);
  await expect(avatar).toHaveScreenshot("avatar-fallback.png");
});
