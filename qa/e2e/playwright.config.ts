import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const outputRoot = "./playwright-output";
const sharedConfig = createPlaywrightDockerConfig({ maxWorkers: 2 });

// Apply the shared configuration first so Playwright can merge these repository-specific settings
// with the Docker server, stable snapshot paths, CI safeguards, and debugging defaults.
export default defineConfig(sharedConfig, {
  testDir: "./test-e2e",
  // Each test walks a whole journey and has steps that wait up to 90 s, so Playwright's default of
  // 30 s runs out on a busy machine. A debugging session keeps its own, longer timeout.
  timeout: sharedConfig.timeout ?? 90_000,
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
