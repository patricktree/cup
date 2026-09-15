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
