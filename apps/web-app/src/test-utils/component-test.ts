import {
  expect as baseExpect,
  test,
  type Locator,
  type Page,
  type PageAssertionsToHaveScreenshotOptions,
} from "@playwright/test";

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
  async toHaveScreenshot(
    receiver: Locator | Page,
    nameOrOptions?: ScreenshotName | ScreenshotOptions,
    options?: ScreenshotOptions,
  ) {
    if (!test.info().tags.includes(VISUAL_TAG)) {
      return {
        name: "toHaveScreenshot",
        pass: false,
        message: () =>
          `Tag a test that asserts a screenshot with "${VISUAL_TAG}", so that it runs in all four browser projects: test(title, { tag: "${VISUAL_TAG}" }, body).`,
      };
    }

    const assertions: ScreenshotAssertions = baseExpect(receiver);
    await (isScreenshotName(nameOrOptions)
      ? assertions.toHaveScreenshot(nameOrOptions, options)
      : assertions.toHaveScreenshot(nameOrOptions));
    return { name: "toHaveScreenshot", pass: true, message: () => "" };
  },
});

type ScreenshotName = string | ReadonlyArray<string>;

type ScreenshotOptions = PageAssertionsToHaveScreenshotOptions;

/**
 * Playwright's two `toHaveScreenshot` overloads, for a page or a locator. `expect` of a `Locator |
 * Page` is a union of page and locator assertions, whose overloaded methods TypeScript cannot call;
 * both are assignable to this type, whose options are the page's, a superset of the locator's.
 */
type ScreenshotAssertions = {
  toHaveScreenshot(name: ScreenshotName, options?: ScreenshotOptions): Promise<void>;
  toHaveScreenshot(options?: ScreenshotOptions): Promise<void>;
};

function isScreenshotName(
  nameOrOptions: ScreenshotName | ScreenshotOptions | undefined,
): nameOrOptions is ScreenshotName {
  return typeof nameOrOptions === "string" || Array.isArray(nameOrOptions);
}
