import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const outputRoot = "./playwright-output";

// Apply the shared configuration first so Playwright can merge these repository-specific settings
// with the Docker server, stable snapshot paths, CI safeguards, and debugging defaults.
export default defineConfig(createPlaywrightDockerConfig({ maxWorkers: 2 }), {
  testDir: "./test-e2e",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0 },
  },
  outputDir: path.join(outputRoot, "test-results"),
  reporter: [["html", { open: "never", outputFolder: path.join(outputRoot, "html-report") }]],
  projects: [
    {
      name: "mobile-chromium",
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
  ],
  use: {
    locale: "en-US",
    timezoneId: "Europe/Vienna",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
