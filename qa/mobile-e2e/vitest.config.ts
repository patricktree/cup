import { config as baseConfig } from "@patricktree-stack/config-vitest/vitest-base.js";
import { defineConfig, mergeConfig } from "vitest/config";

/** Specs every platform runs; platform-only specs sit in `test/<platform>/`. */
const SHARED_SPECS = "test/*.test.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // One device per platform per run: spec files run one after another.
      fileParallelism: false,
      retry: 0,
      hookTimeout: 180_000,
      testTimeout: 120_000,
      projects: [
        {
          extends: true,
          test: {
            name: "android",
            include: [SHARED_SPECS, "test/android/**/*.test.ts"],
            globalSetup: ["src/android/global-setup.ts"],
            provide: { mobilePlatform: "android" },
          },
        },
        {
          extends: true,
          test: {
            name: "ios",
            include: [SHARED_SPECS, "test/ios/**/*.test.ts"],
            globalSetup: ["src/ios/global-setup.ts"],
            provide: { mobilePlatform: "ios" },
          },
        },
      ],
    },
  }),
);
