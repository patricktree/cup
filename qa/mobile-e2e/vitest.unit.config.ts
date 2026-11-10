import { config as baseConfig } from "@patricktree-stack/config-vitest/vitest-base.js";
import { defineConfig, mergeConfig } from "vitest/config";

/** Unit tests of the suite's own helpers; they need no device, unlike `vitest.config.ts`. */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["test-unit/**/*.test.ts"],
    },
  }),
);
