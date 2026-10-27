import { defineConfig } from "oxlint";

import { config as repoConfig, restrictImports } from "@cup/config-oxlint/oxlint-base.js";

/*
 * Keeps the contracts runtime-independent: the Worker, the workflows, and (through the listener
 * contracts) the browser load them.
 */
export default defineConfig({
  extends: [repoConfig],
  overrides: [
    {
      files: ["src/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["cloudflare:*", "node:*"],
          message:
            "The conversion contracts are runtime-independent: the Worker, the workflows and the browser load them. Pass runtime capabilities in as parameters instead.",
        }),
      },
    },
  ],
});
