import { expect, test } from "@playwright/test";

test("renders landing", async ({ mount }) => {
  const component = await mount("routes/index/LandingPage");
  await expect(component.getByRole("heading", { name: "Just listen." })).toBeVisible();
  await expect(component).toHaveScreenshot("landing.png");
});

test("anonymous submission asks for sign-in and cancellation preserves the URL", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/index/LandingPage");
  const input = component.getByRole("textbox", { name: "URL" });
  await input.fill("https://example.com/article");
  await component.getByRole("button", { name: "Load & listen" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in to convert" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await expect(page).toHaveScreenshot("signup-dialog.png");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(component.getByRole("button", { name: "Load & listen" })).toBeFocused();
  await expect(input).toHaveValue("https://example.com/article");
  await expect(page.getByRole("dialog", { name: "Sign in to convert" })).not.toBeVisible();
  await page.reload();
  await mount("routes/index/LandingPage");
  await expect(input).toHaveValue("https://example.com/article");
  await expect(component.getByRole("button", { name: "Load & listen" })).toBeEnabled();
  await component.getByRole("button", { name: "Load & listen" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in to convert" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Sign in to convert" })).not.toBeVisible();
  await expect(input).toHaveValue("https://example.com/article");
});

test("invalid account URL shows a field error and becomes submittable after correction", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/index/LandingPage");
  const input = component.getByRole("textbox", { name: "URL" });
  await input.fill("ftp://example.com/article");
  await component.getByRole("button", { name: "Load & listen" }).click();
  await expect(
    component.getByText("URL must use HTTP or HTTPS and cannot contain credentials", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("dialog", { name: "Sign in to convert" })).not.toBeVisible();
  await input.fill("https://example.com/article");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await component.getByRole("button", { name: "Load & listen" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in to convert" })).toBeVisible();
});
