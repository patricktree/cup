import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

import { REQUEST_ONLY_TAG, VISUAL_TAG } from "#test-e2e/browser-project-tags.ts";

const outputRoot = "./playwright-output";
// 8 workers passed three consecutive runs and were the fastest on an M4 Max; 10 and 12 were slower
// and 14 timed out (README, "Runtime").
const dockerConfig = createPlaywrightDockerConfig({ maxWorkers: 8 });
/**
 * Desktop Chromium and mobile WebKit run every test, so both engines and both viewports see every
 * journey; the other two projects run only the tests tagged visual, and tests tagged request-only
 * run in desktop Chromium alone (`test-e2e/browser-project-tags.ts`).
 */
const VISUAL_TESTS_ONLY = new RegExp(VISUAL_TAG);
const REQUEST_ONLY_TESTS = new RegExp(REQUEST_ONLY_TAG);

// Apply the shared configuration first so Playwright can merge these repository-specific settings
// with the Docker server, stable snapshot paths, CI safeguards, and debugging defaults.
export default defineConfig(dockerConfig, {
  testDir: "./test-e2e",
  // `defineConfig` replaces rather than merges `globalSetup`, so the Docker server setup is kept here.
  globalSetup: [
    ...(dockerConfig.globalSetup === undefined ? [] : [dockerConfig.globalSetup].flat()),
    "./test-e2e/https-certificate.global-setup.ts",
  ],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0 },
  },
  outputDir: path.join(outputRoot, "test-results"),
  reporter: [["html", { open: "never", outputFolder: path.join(outputRoot, "html-report") }]],
  projects: [
    {
      name: "mobile-chromium",
      grep: VISUAL_TESTS_ONLY,
      use: {
        ...devices["Pixel 9 Pro"],
      },
    },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "mobile-webkit",
      grepInvert: REQUEST_ONLY_TESTS,
      use: {
        ...devices["iPhone 15 Pro"],
      },
    },
    {
      name: "desktop-webkit",
      grep: VISUAL_TESTS_ONLY,
      use: {
        ...devices["Desktop Safari"],
      },
    },
  ],
  use: {
    // The Worker serves HTTPS with a certificate that global setup signs itself.
    ignoreHTTPSErrors: true,
    locale: "en-US",
    timezoneId: "Europe/Vienna",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
