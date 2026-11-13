import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

import { VISUAL_TAG } from "#src/test-utils/component-test.ts";

const outputRoot = "./playwright-output";
// oxlint-disable-next-line node/no-process-env -- The shared Docker configuration uses CI to select its safeguards.
const isCI = Boolean(process.env["CI"]);
// oxlint-disable-next-line node/no-process-env -- Playwright publishes the gallery port captured by webServer.wait.stdout to workers through the environment.
const galleryPort = process.env["CUP_UI_GALLERY_PORT"] ?? "";
// 8 workers passed three consecutive runs in 4.9 min on an M4 Max; 10 and 12 were slower and each
// failed a test (web app README, "Runtime").
const dockerConfig = createPlaywrightDockerConfig({ isCI, maxWorkers: 8 });
/**
 * Desktop Chromium and mobile WebKit run every test, so both engines and both viewports see every
 * behaviour; the other two projects run only the tests tagged visual
 * (`src/test-utils/component-test.ts`).
 */
const VISUAL_TESTS_ONLY = new RegExp(VISUAL_TAG);

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
    ...dockerConfig.use,
    ...(dockerConfig.use?.connectOptions && {
      connectOptions: {
        ...dockerConfig.use.connectOptions,
        // The browsers reach the gallery through the connection to the Playwright Server: on Docker
        // Desktop for macOS some new connections from the container to the host never complete,
        // and WebKit, unlike Chromium, opens no second connection, so its page loads stalled.
        exposeNetwork: "<loopback>",
      },
    }),
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
      // The tests load a build of the gallery rather than the development server, which transforms
      // modules on request and can push hot updates into a running test (web app README, "Runtime").
      command: "pnpm run build:gallery && pnpm run preview:gallery --port 0",
      // React's development build keeps the warnings that tests record (`src/test-utils/react-use-warnings.ts`).
      env: { NODE_ENV: "development" },
      // Playwright exports the named capture group to the environment that workers read above.
      wait: { stdout: /Local:\s+http:\/\/127\.0\.0\.1:(?<CUP_UI_GALLERY_PORT>\d+)\// },
      timeout: 60_000,
    },
  ],
});
