import { expect, test } from "#test-e2e/fixtures.ts";

test("a screenshot assertion in a test without the visual tag fails, naming the tag", async ({
  browser,
}) => {
  // A page of its own, so that the test starts no test Worker for the fixture's page.
  const page = await browser.newPage();
  await page.setContent("<p>A test without the visual tag</p>");

  await expect(expect(page).toHaveScreenshot("untagged.png")).rejects.toThrow(
    'Tag a test that asserts a screenshot with "@visual"',
  );
  await page.close();
});
