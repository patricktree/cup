import { defineConfig, devices } from "@playwright/test";

import componentTestConfig from "#playwright.config.ts";

/** Runs `src/design-check.run.ts` on request; the component tests leave that file out by its name. */
export default defineConfig({
  ...componentTestConfig,
  testMatch: "design-check.run.ts",
  reporter: "line",
  projects: [{ name: "design-check", use: { ...devices["Desktop Chrome"] } }],
});
