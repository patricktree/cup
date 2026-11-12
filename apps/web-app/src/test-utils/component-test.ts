import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

/**
 * Runs a component test in all four browser projects instead of only desktop Chromium and mobile
 * WebKit (`playwright.config.ts`). Every test that asserts a screenshot carries it, and so does
 * every test whose behaviour depends on the engine or the viewport.
 */
export const VISUAL_TAG = "@visual";

export { test };

/**
 * Playwright's `expect`, whose `toHaveScreenshot` fails in a test without {@link VISUAL_TAG}, so a
 * screenshot cannot silently lose the two browser projects that run only visual tests.
 */
export const expect = baseExpect.extend({
  async toHaveScreenshot(receiver: Locator | Page, name: string) {
    if (!test.info().tags.includes(VISUAL_TAG)) {
      return {
        name: "toHaveScreenshot",
        pass: false,
        message: () =>
          `Tag a test that asserts a screenshot with "${VISUAL_TAG}", so that it runs in all four browser projects: test(title, { tag: "${VISUAL_TAG}" }, body).`,
      };
    }

    await (isPage(receiver)
      ? baseExpect(receiver).toHaveScreenshot(name)
      : baseExpect(receiver).toHaveScreenshot(name));
    return { name: "toHaveScreenshot", pass: true, message: () => "" };
  },
});

function isPage(receiver: Locator | Page): receiver is Page {
  return "goto" in receiver;
}
