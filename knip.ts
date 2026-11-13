import type { KnipConfig } from "knip";

const config: KnipConfig = {
  $schema: "./node_modules/knip/schema.json",
  ignore: [
    /* ignore the patricktree-stack packages themselves, since they are not part of this monorepo */
    ".patricktree-stack/**",
  ],
  workspaces: {
    ".": {
      /* Zizmor is an external validation tool installed through uvx, not a Node dependency */
      ignoreBinaries: ["uvx"],
      ignoreDependencies: [
        "husky",
        "@emnapi/core",
        "@emnapi/runtime",
        /* `cf` is an intentional CLI-only dependency used by agents for Cloudflare inspection */
        "cf",
      ],
    },
    "apps/cloudflare-worker": {
      /* Wrangler loads this module-only Worker entry point from test/wrangler.test.jsonc. */
      entry: ["test/worker.ts"],
    },
    "libs/create-audiobook-from-url-workflow": {
      /* Wrangler loads this module-only Worker entry point from wrangler.test.jsonc. */
      entry: ["test/worker.ts"],
      ignoreDependencies: [
        /* knip doesn't detect `declare module "cloudflare:workers"` from Worker types */
        "cloudflare",
      ],
    },
    "apps/web-app": {
      /* Playwright and Vite load these component-testing modules indirectly. */
      entry: [
        "src/**/*.story.tsx",
        /* fidelity-check/cli.ts starts Playwright with this config, which runs run.ts. */
        "playwright.fidelity-check.config.ts",
        "fidelity-check/run.ts",
      ],
    },
    "libs/registry": {
      /* Wrangler loads the integration Worker and its Cloudflare virtual module. */
      entry: ["test/worker.ts"],
      ignoreDependencies: ["cloudflare"],
    },
    "libs/accounts": {
      /* Wrangler loads this module-only Worker entry point from wrangler.test.jsonc. */
      entry: ["test/worker.ts"],
      ignoreDependencies: [
        /* knip doesn't detect `declare module "cloudflare:workers"` from Worker types */
        "cloudflare",
      ],
    },
    "libs/conversion-grants": {
      /* Wrangler loads this module-only Worker entry point from wrangler.test.jsonc. */
      entry: ["test/worker.ts"],
      ignoreDependencies: [
        /* knip doesn't detect `declare module "cloudflare:workers"` from Worker types */
        "cloudflare",
      ],
    },
    "qa/e2e": {
      /* The global setup signs the suite's local HTTPS certificate with the system's openssl */
      ignoreBinaries: ["openssl"],
    },
    "qa/mobile-e2e": {
      /* The suite builds the native apps from this package's projects, so its cached E2E tasks must hash them. */
      ignoreDependencies: ["@cup/mobile-app"],
    },
    "qa/test-worker": {
      /* These dependencies express the built-app test dependency graph. */
      ignoreDependencies: [
        "@cup/cloudflare-worker",
        /* knip doesn't detect `declare module "cloudflare:workers"` from Worker types */
        "cloudflare",
      ],
    },
    "libs/audiobook-production": {
      /* Live evals use separate Vitest discovery, so Knip cannot infer these entry points */
      entry: ["vitest.evals.config.ts", "test/evals/**/*.eval.ts"],
    },
    "libs/narration-source-analysis": {
      /* Live evals use separate Vitest discovery, so Knip cannot infer these entry points */
      entry: ["vitest.evals.config.ts", "test/evals/**/*.eval.ts"],
    },
  },
};

export default config;
