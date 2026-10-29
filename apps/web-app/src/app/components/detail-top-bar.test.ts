import { expect, test } from "@playwright/test";

test("the plain top bar shows back and the menu", async ({ mount }) => {
  const component = await mount("app/components/detail-top-bar/Plain");
  const topBar = component.getByRole("banner");

  await expect(topBar.getByRole("link", { name: "Back" })).toBeVisible();
  await expect(topBar.getByRole("button", { name: "More", exact: true })).toBeVisible();
  await expect(topBar).toHaveScreenshot("detail-top-bar-plain.png");
});

test("the compact top bar shows the title and host, cut off when too long", async ({ mount }) => {
  const component = await mount("app/components/detail-top-bar/Compact");
  const topBar = component.getByRole("banner");

  await expect(topBar.getByText("source.example.test", { exact: true })).toBeVisible();
  await expect(topBar).toHaveScreenshot("detail-top-bar-compact.png");
});

test("the top bar's menu offers the original page, Retry and Delete track…", async ({
  mount,
  page,
}) => {
  const component = await mount("app/components/detail-top-bar/Plain");
  await component.getByRole("button", { name: "More", exact: true }).click();

  await expect(page.getByRole("menuitem", { name: "Open original page" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete track…" })).toBeVisible();
  await expect(page).toHaveScreenshot("detail-top-bar-menu-open.png");
});
