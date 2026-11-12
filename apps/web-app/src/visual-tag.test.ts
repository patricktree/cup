import { expect, test } from "#src/test-utils/component-test.ts";

test("a screenshot assertion in a test without the visual tag fails, naming the tag", async ({
  page,
}) => {
  await page.setContent("<p>A test without the visual tag</p>");

  await expect(expect(page).toHaveScreenshot("untagged.png")).rejects.toThrow(
    'Tag a test that asserts a screenshot with "@visual"',
  );
});
