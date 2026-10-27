import { defineConfig } from "oxlint";

import { config as repoConfig } from "@cup/config-oxlint/oxlint-base.js";

type RestrictedImportsOptions = { paths?: unknown[]; patterns?: unknown[] };

/*
 * Keeps the contracts runtime-independent: the Worker, the workflows, and (through the listener
 * contracts) the browser load them. The entry replaces the repository's `no-restricted-imports`
 * options, so it keeps their paths and patterns and adds its own.
 */
const [severity, ...repoOptions] = (repoConfig.rules?.["no-restricted-imports"] ?? ["error"]) as [
  string,
  ...RestrictedImportsOptions[],
];

export default defineConfig({
  extends: [repoConfig],
  overrides: [
    {
      files: ["src/**"],
      rules: {
        "no-restricted-imports": [
          severity,
          {
            paths: repoOptions.flatMap((options) => options.paths ?? []),
            patterns: [
              ...repoOptions.flatMap((options) => options.patterns ?? []),
              {
                group: ["cloudflare:*", "node:*"],
                message:
                  "The conversion contracts are runtime-independent: the Worker, the workflows and the browser load them. Pass runtime capabilities in as parameters instead.",
              },
            ],
          },
        ],
      },
    },
  ],
});
