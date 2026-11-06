import { createPlaywrightDockerConfig } from "@patricktree-stack/config-playwright/playwright-docker";
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const outputRoot = "./playwright-output";

export default defineConfig(createPlaywrightDockerConfig({ maxWorkers: 2 }), {
  testDir: "./test",
  outputDir: path.join(outputRoot, "test-results"),
  reporter: [["html", { open: "never", outputFolder: path.join(outputRoot, "html-report") }]],
  projects: [{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } }],
});
