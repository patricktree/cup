import { defineConfig } from "oxlint";

import { config as repoConfig, restrictImports } from "@cup/config-oxlint/oxlint-base.js";

/*
 * Enforces the import directions between the source folders that AGENTS.md describes.
 */
export default defineConfig({
  extends: [repoConfig],
  overrides: [
    {
      files: ["src/api-server-environment.ts"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["#src/**"],
          message: "The environment bindings import nothing else from the package.",
        }),
      },
    },
    {
      files: ["src/http/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["#src/api-server.ts"],
          message:
            "`http/` does not import the package entry; `src/api-server.ts` composes `http/`.",
        }),
      },
    },
    {
      files: ["src/use-cases/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["#src/api-server.ts", "#src/http/**"],
          message:
            "`use-cases/` imports neither `http/` nor the package entry; the package entry and `http/` call the use cases.",
        }),
      },
    },
    {
      files: ["src/adapters/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["#src/api-server.ts", "#src/http/**", "#src/use-cases/**"],
          message:
            "`adapters/` imports neither `http/`, `use-cases/`, nor the package entry; the package entry and `http/` call the adapters.",
        }),
      },
    },
  ],
});
