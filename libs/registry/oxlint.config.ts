import { defineConfig } from "oxlint";

import { config as repoConfig, restrictImports } from "@cup/config-oxlint/oxlint-base.js";

/*
 * Enforces the import directions between the source folders that AGENTS.md describes.
 */
export default defineConfig({
  extends: [repoConfig],
  rules: {
    "no-restricted-imports": restrictImports({
      group: ["#src/durable-object/**"],
      message:
        "Only `src/index.ts` imports `durable-object/`; import the package interface instead.",
    }),
  },
  overrides: [
    {
      files: ["src/index.ts"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["#src/migrations/**"],
          message: "`src/index.ts` reaches the generated migrations only through `storage/`.",
        }),
      },
    },
    {
      files: ["src/encoding.ts", "src/time.ts"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["#src/**"],
          message: "The shared helpers import nothing else from the package.",
        }),
      },
    },
    {
      files: ["src/domain/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: [
            "#src/index.ts",
            "#src/storage/**",
            "#src/providers/**",
            "#src/account-deletion/**",
            "#src/durable-object/**",
            "#src/migrations/**",
          ],
          message: "`domain/` imports only `domain/` and the shared helpers.",
        }),
      },
    },
    {
      files: ["src/storage/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: [
            "#src/index.ts",
            "#src/providers/**",
            "#src/account-deletion/**",
            "#src/durable-object/**",
          ],
          message:
            "`storage/` imports only `domain/`, the shared helpers, and the generated migrations; its callers sit above it.",
        }),
      },
    },
    {
      files: ["src/providers/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: [
            "#src/index.ts",
            "#src/storage/**",
            "#src/account-deletion/**",
            "#src/durable-object/**",
            "#src/migrations/**",
          ],
          message:
            "`providers/` imports only `domain/` and the shared helpers; the use cases call the providers.",
        }),
      },
    },
    {
      files: ["src/account-deletion/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["#src/index.ts", "#src/durable-object/**", "#src/migrations/**"],
          message:
            "`account-deletion/` imports neither `durable-object/` nor the package interface, and reaches the generated migrations only through `storage/`.",
        }),
      },
    },
    {
      files: ["src/durable-object/**"],
      rules: {
        "no-restricted-imports": restrictImports({
          group: ["#src/index.ts", "#src/migrations/**"],
          message:
            "`durable-object/` never imports the package interface that re-exports it, and reaches the generated migrations only through `storage/`.",
        }),
      },
    },
  ],
});
