import { config as baseConfig } from "@patricktree-stack/config-vitest/vitest-base.js";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["test/evals/**/*.eval.ts"],
      fileParallelism: false,
      maxWorkers: 1,
      sequence: {
        concurrent: false,
      },
      testTimeout: 600_000,
      hookTimeout: 600_000,
    },
  }),
);
