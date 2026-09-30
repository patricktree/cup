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
        /* oxlint doesn't resolve dependencies correctly, we need it in the root node_modules */
        "eslint-plugin-react-you-might-not-need-an-effect",
      ],
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
      entry: ["ui-gallery/main.tsx", "src/**/*.story.tsx"],
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
      /* These dependencies express the built-app test dependency graph. */
      ignoreDependencies: [
        "@cup/cloudflare-worker",
        /* knip doesn't detect `declare module "cloudflare:workers"` from Worker types */
        "cloudflare",
      ],
    },
    "libs/narration-content-selection": {
      /* Live evals use separate Vitest discovery, so Knip cannot infer these entry points */
      entry: ["vitest.evals.config.ts", "test/evals/**/*.eval.ts"],
    },
    "libs/prepare-source-material": {
      /* Playwright starts this fixture server through its webServer command. */
      entry: ["test-e2e/source-page-server.ts"],
    },
  },
};

export default config;
