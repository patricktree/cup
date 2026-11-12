/**
 * Runs a test in all four browser projects instead of only desktop Chromium and mobile WebKit
 * (`playwright.config.ts`). Every test that asserts a screenshot carries it, and so does every test
 * whose behaviour depends on the engine or the viewport, such as the browser's handling of
 * redirects, URL fragments, history and reloads. The web app component tests use the same tag.
 */
export const VISUAL_TAG = "@visual";

/**
 * Runs a test in desktop Chromium only: a test that sends its requests through Playwright's
 * `request` fixture never reaches a browser, so another project would repeat it unchanged.
 */
export const REQUEST_ONLY_TAG = "@request-only";
