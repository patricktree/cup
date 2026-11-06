import { defineConfig, devices } from "@playwright/test";

import componentTestConfig from "#playwright.config.ts";

/** Runs `scripts/fidelity-check/run.ts`, which `scripts/fidelity-check/cli.ts` starts. */
export default defineConfig({
  ...componentTestConfig,
  testDir: "./scripts/fidelity-check",
  testMatch: "run.ts",
  reporter: "line",
  projects: [{ name: "fidelity-check", use: { ...devices["Desktop Chrome"] } }],
});
