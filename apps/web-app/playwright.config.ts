import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const GALLERY_URL = "http://127.0.0.1:3100/ui-gallery/index.html?canvas=1";
const outputRoot = "./playwright-output";
// oxlint-disable-next-line node/no-process-env -- Playwright uses CI to select server reuse safeguards.
const isCI = Boolean(process.env["CI"]);
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
    baseURL: GALLERY_URL,
    serviceWorkers: "allow",
    colorScheme: "light",
    locale: "en-US",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Vienna",
    trace: "retain-on-failure",
  },
  webServer: [
    ...(dockerConfig.webServer === undefined
      ? []
      : Array.isArray(dockerConfig.webServer)
        ? dockerConfig.webServer
        : [dockerConfig.webServer]),
    {
      command: "pnpm run dev:gallery",
      url: GALLERY_URL,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
  ],
});
