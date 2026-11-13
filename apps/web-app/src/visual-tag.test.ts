import { expect, test, VISUAL_TAG } from "#src/test-utils/component-test.ts";

test("a screenshot assertion in a test without the visual tag fails, naming the tag", async ({
  page,
}) => {
  await page.setContent("<p>A test without the visual tag</p>");

  await expect(expect(page).toHaveScreenshot("untagged.png")).rejects.toThrow(
    'Tag a test that asserts a screenshot with "@visual"',
  );
});

test(
  "a screenshot assertion in a test with the visual tag passes its options to Playwright",
  { tag: VISUAL_TAG },
  async ({ page }) => {
    await page.setContent("<p>A test with the visual tag</p>");

    // Playwright rejects a negative `maxDiffPixels` before it takes or compares a screenshot, so
    // the assertion fails this way only if the options reach it, with or without a name.
    await expect(expect(page).toHaveScreenshot({ maxDiffPixels: -1 })).rejects.toThrow(
      "`maxDiffPixels` option value must be non-negative integer",
    );
    await expect(
      expect(page.locator("p")).toHaveScreenshot("options.png", { maxDiffPixels: -1 }),
    ).rejects.toThrow("`maxDiffPixels` option value must be non-negative integer");
  },
);
