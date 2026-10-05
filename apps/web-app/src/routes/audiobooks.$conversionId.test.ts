import { expect, test } from "@playwright/test";

test("renders audiobook without showing preparation skeletons", async ({ mount, page }) => {
  await page.addInitScript(() => {
    const skeletonSelector = '[aria-label="Preparing article"]';
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches(skeletonSelector) || node.querySelector(skeletonSelector))
          ) {
            document.documentElement.dataset["sawReaderSkeleton"] = "true";
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });

  const component = await mount("routes/audiobooks.$conversionId/ReadyAudiobook");
  await expect(
    component.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await expect(
    component.getByText("Keep the important boundaries real.", { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole("link", { name: /Download/ })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.dataset["sawReaderSkeleton"]),
  ).toBeUndefined();
  await expect(component).toHaveScreenshot("audiobook.png");
});

test("renders audiobook-not-found", async ({ mount }) => {
  const component = await mount("routes/audiobooks.$conversionId/AudiobookNotFound");
  await expect(
    component.getByRole("heading", { name: "The article could not be loaded." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("audiobook-not-found.png");
});

test("renders audiobook-load-error", async ({ mount, page }) => {
  const component = await mount("routes/audiobooks.$conversionId/AudiobookLoadError");
  await expect(
    component.getByRole("heading", { name: "The article could not be loaded." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("audiobook-load-error.png");

  await page.route("**/api/audiobooks/*", (route) =>
    route.fulfill({
      json: { status: "pending", originalUrl: "https://example.com/article", canGenerate: true },
    }),
  );
  await component.getByRole("button", { name: "Try again" }).click();
  await expect(component.getByRole("status")).toHaveText("Preparing article…");
});

test("shows preparation skeletons with disabled Play", async ({ mount }) => {
  const component = await mount("routes/audiobooks.$conversionId/PendingConversion");
  await expect(component.getByRole("status")).toHaveText("Preparing article…");
  await expect(component.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(component).toHaveScreenshot("pending-conversion.png");
});
test("preparation failure replaces skeletons with Retry", async ({ mount }) => {
  const component = await mount("routes/audiobooks.$conversionId/FailedConversion");
  await expect(
    component.getByRole("heading", { name: "The article could not be prepared." }),
  ).toBeVisible();
  await expect(component.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  await expect(component).toHaveScreenshot("failed-conversion.png");
});
