import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig } from "@playwright/test";

const dockerConfig = createPlaywrightDockerConfig({ maxWorkers: 2 });

export default defineConfig({
  ...dockerConfig,
  testDir: "./test-e2e",
  timeout: 120_000,
  outputDir: "./playwright-output/test-results",
  reporter: [["html", { open: "never", outputFolder: "./playwright-output/html-report" }]],
  // HTML baselines stay beside the tests rather than using platform-specific image paths.
  snapshotPathTemplate: "{testDir}/{arg}{ext}",
  webServer: [
    ...(dockerConfig.webServer ? [dockerConfig.webServer].flat() : []),
    {
      command: "node test-e2e/source-page-server.ts",
      url: "http://127.0.0.1:4187/health",
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
  use: {
    ...dockerConfig.use,
    baseURL: "http://127.0.0.1:4187",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
});
