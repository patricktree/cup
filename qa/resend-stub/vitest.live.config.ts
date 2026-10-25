import { config as baseConfig } from "@patricktree-stack/config-vitest/vitest-base.js";
import { defineConfig, mergeConfig } from "vitest/config";

/** `pnpm test:resend-live`: the opt-in contract test against the real Resend API. */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["test-live/**/*.test.ts"],
      /* A retry would send more real emails and could hide a contract mismatch. */
      retry: 0,
      /* Each test makes a few real HTTPS requests to Resend. */
      testTimeout: 30_000,
    },
  }),
);
