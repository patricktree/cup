import { defineConfig, devices } from "@playwright/test";

import componentTestConfig from "#playwright.config.ts";

/** Runs `fidelity-check/run.ts`, which `fidelity-check/cli.ts` starts. */
export default defineConfig({
  ...componentTestConfig,
  testDir: "./fidelity-check",
  testMatch: "run.ts",
  reporter: "line",
  projects: [{ name: "fidelity-check", use: { ...devices["Desktop Chrome"] } }],
});
