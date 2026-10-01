import { expect, test } from "@playwright/test";

test("renders pending-conversion", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const component = await mount("routes/conversions.$conversionId/PendingConversion");
  await expect(
    component.getByRole("status").filter({ hasText: "Selecting narration content..." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("pending-conversion.png");
});

test("renders failed-conversion", async ({ mount }) => {
  const component = await mount("routes/conversions.$conversionId/FailedConversion");
  await expect(component.getByText("Speech synthesis failed.", { exact: true })).toBeVisible();
  await expect(component).toHaveScreenshot("failed-conversion.png");
});

test("renders conversion-load-error", async ({ mount }) => {
  const component = await mount("routes/conversions.$conversionId/ConversionLoadError");
  await expect(
    component.getByRole("heading", { name: "The conversion could not be opened." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("conversion-load-error.png");
});

test("advances and resets the interactive conversion", async ({ mount }) => {
  const component = await mount("routes/conversions.$conversionId/InteractiveConversion");
  await expect(component.getByText("Starting conversion...")).toBeVisible();
  for (let index = 0; index < 4; index++)
    await component.getByRole("button", { name: "Next phase" }).click();
  await expect(component.getByText("Producing narration audio...")).toBeVisible();
  await expect(component.getByText("4 of 8 phases completed (50%)")).toBeVisible();
  for (let index = 0; index < 3; index++)
    await component.getByRole("button", { name: "Next phase" }).click();
  await expect(component.getByText("Finalizing conversion...")).toBeVisible();
  await component.getByRole("button", { name: "Start again" }).click();
  await expect(component.getByText("Starting conversion...")).toBeVisible();
});
