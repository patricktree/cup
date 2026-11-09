import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const outputRoot = "./playwright-output";
const dockerConfig = createPlaywrightDockerConfig({ maxWorkers: 2 });

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
      use: {
        ...devices["iPhone 15 Pro"],
      },
    },
    {
      name: "desktop-webkit",
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
