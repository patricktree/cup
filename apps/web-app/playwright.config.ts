import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const outputRoot = "./playwright-output";
// oxlint-disable-next-line node/no-process-env -- The shared Docker configuration uses CI to select its safeguards.
const isCI = Boolean(process.env["CI"]);
// oxlint-disable-next-line node/no-process-env -- Playwright publishes the gallery port captured by webServer.wait.stdout to workers through the environment.
const galleryPort = process.env["CUP_UI_GALLERY_PORT"] ?? "";
const dockerConfig = createPlaywrightDockerConfig({ isCI, maxWorkers: 4 });

export default defineConfig({
  ...dockerConfig,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0 },
  },
  outputDir: path.join(outputRoot, "test-results"),
  reporter: [["html", { open: "never", outputFolder: path.join(outputRoot, "html-report") }]],
  testDir: "./src",
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
    ...dockerConfig.use,
    baseURL: `http://127.0.0.1:${galleryPort}/ui-gallery/index.html?canvas=1`,
    serviceWorkers: "allow",
    colorScheme: "light",
    locale: "en-US",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Vienna",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // Each run starts its own gallery on a port the operating system assigns, so concurrent runs and
      // gallery servers from other checkouts cannot collide with or stand in for this one.
      command: "pnpm run dev:gallery --port 0",
      // Playwright exports the named capture group to the environment that workers read above.
      wait: { stdout: /Local:\s+http:\/\/127\.0\.0\.1:(?<CUP_UI_GALLERY_PORT>\d+)\// },
      timeout: 30_000,
    },
  ],
});
