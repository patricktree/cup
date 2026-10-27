import { expect, test } from "@playwright/test";

test("renders all design system variants", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/Components");

  await expect(component.getByRole("main")).toHaveScreenshot("design-system.png");
});

test("records button clicks and renders disabled states", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/Components");

  for (const variant of ["outlined", "contained", "text"]) {
    const section = component.getByRole("region", { name: `${variant} buttons` });
    await expect(section.getByRole("button", { name: "Record click" })).toHaveAttribute(
      "data-variant",
      variant,
    );
    await expect(section.getByRole("button", { name: "Disabled" })).toBeDisabled();
    await expect(section.getByRole("button", { name: "Working" })).toBeDisabled();
    await section.getByRole("button", { name: "Record click" }).click();
  }

  await expect(component.getByRole("status")).toHaveText("Clicks: 3");
});

test("supports input interaction and accessible errors", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/Components");

  await component.getByLabel("Text", { exact: true }).fill("Example text");
  await expect(component.getByLabel("Text", { exact: true })).toHaveValue("Example text");
  await expect(component.getByLabel("Disabled", { exact: true })).toBeDisabled();
  await expect(
    component.getByRole("textbox", { name: "Invalid", exact: true }),
  ).toHaveAccessibleDescription("Please enter a valid value.");
  await expect(component.getByLabel("Hidden label", { exact: true })).toBeVisible();
});

test("keeps Space Mono outside the Inter typeface scope only", async ({ mount }) => {
  const components = await mount("app/design-system/design-system/Components");
  const input = components.getByLabel("Text", { exact: true });
  expect(await input.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    "Space Mono",
  );

  const colors = await mount("app/design-system/design-system/Colors");
  const label = colors.getByText("--color-ink", { exact: true });
  expect(await label.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
    "Inter",
  );
});

test("renders the color tokens", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/Colors");

  await expect(component.getByRole("main")).toHaveScreenshot("colors.png");
});

test("renders the text styles", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/TextStyles");

  await expect(component.getByRole("main")).toHaveScreenshot("text-styles.png");
});

test("renders the drawn icons", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/Icons");

  await expect(component.getByRole("listitem")).toHaveCount(11);
  await expect(component.getByRole("main")).toHaveScreenshot("icons.png");
});

test("renders enabled and disabled icon buttons", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/IconButtons");

  await expect(
    component.getByRole("region", { name: "Disabled" }).getByRole("button", { name: "Play" }),
  ).toBeDisabled();
  await expect(component.getByRole("main")).toHaveScreenshot("icon-buttons.png");
});

test("shows the focus ring on a keyboard-focused icon button", async ({ mount, page }) => {
  const component = await mount("app/design-system/design-system/IconButtons");
  const enabled = component.getByRole("region", { name: "Enabled" });

  await enabled.getByRole("button", { name: "More" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(enabled.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  await expect(component.getByRole("main")).toHaveScreenshot("icon-button-focused.png");
});

test("shows the overlay on a pressed icon button", async ({ mount, page }) => {
  const component = await mount("app/design-system/design-system/IconButtons");
  const enabled = component.getByRole("region", { name: "Enabled" });

  await enabled.getByRole("button", { name: "Play" }).hover();
  await page.mouse.down();
  await expect(component.getByRole("main")).toHaveScreenshot("icon-button-pressed.png");
  await page.mouse.up();
});

test("renders loaded, loading and circular cover images", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/CoverImages");

  await expect(component.getByRole("img", { name: "Loaded cover" })).toBeVisible();
  await expect(component.getByRole("img", { name: "Circular cover" })).toBeVisible();
  await expect(component.getByRole("img", { name: "Loading cover" })).toHaveCount(0);
  await expect(component.getByRole("main")).toHaveScreenshot("cover-images.png");
});

test("keeps the previous cover visible until the new one has loaded", async ({ mount }) => {
  const component = await mount("app/design-system/design-system/CoverImageSwap");
  await expect(component.getByRole("img", { name: "first cover" })).toBeVisible();

  await component.getByRole("button", { name: "Show second cover" }).click();
  await expect(component.getByRole("img", { name: "first cover" })).toBeVisible();
  await expect(component.getByRole("img", { name: "second cover" })).toHaveCount(0);

  await component.getByRole("button", { name: "Finish loading" }).click();
  await expect(component.getByRole("img", { name: "second cover" })).toBeVisible();
  await expect(component.getByRole("img", { name: "first cover" })).toHaveCount(0);
});
