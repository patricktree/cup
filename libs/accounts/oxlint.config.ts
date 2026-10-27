import { defineConfig } from "oxlint";

import {
  config as repoConfig,
  restrictImports,
  type RestrictedImportsPattern,
} from "@cup/config-oxlint/oxlint-base.js";

/*
 * Enforces the import directions between the source folders that AGENTS.md describes.
 */
const ARTIFACTS_RESTRICTION: RestrictedImportsPattern = {
  group: ["#src/artifacts/**"],
  message:
    "`artifacts/` runs in the callers' Workers and is reached only through the `./artifact-writer` export.",
};

export default defineConfig({
  extends: [repoConfig],
  rules: {
    "no-restricted-imports": restrictImports(
      {
        group: ["#src/durable-object/**"],
        message:
          "Only `src/index.ts` imports `durable-object/`; import the package interface instead.",
      },
      ARTIFACTS_RESTRICTION,
    ),
  },
  overrides: [
    {
      files: ["src/index.ts"],
      rules: {
        "no-restricted-imports": restrictImports(
          {
            group: ["#src/migrations/**"],
            message: "`src/index.ts` reaches the generated migrations only through `storage/`.",
          },
          ARTIFACTS_RESTRICTION,
        ),
      },
    },
    {
      files: ["src/encoding.ts"],
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
            "#src/durable-object/**",
            "#src/artifacts/**",
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
          group: ["#src/index.ts", "#src/durable-object/**", "#src/artifacts/**"],
          message:
            "`storage/` imports neither `durable-object/`, `artifacts/`, nor the package interface; the Durable Object calls storage.",
        }),
      },
    },
    {
      files: ["src/durable-object/**"],
      rules: {
        "no-restricted-imports": restrictImports(
          {
            group: ["#src/migrations/**"],
            message: "`durable-object/` reaches the generated migrations only through `storage/`.",
          },
          ARTIFACTS_RESTRICTION,
        ),
      },
    },
    {
      files: ["src/artifacts/**"],
      rules: {
        "no-restricted-imports": restrictImports(
          {
            group: ["#src/index.ts", "#src/storage/**", "#src/migrations/**"],
            message:
              "`artifacts/` imports only `domain/`, the shared helpers, and `durable-object/` types.",
          },
          {
            group: ["#src/durable-object/**"],
            message:
              "`artifacts/` imports `durable-object/` only with `import type`, so the callers' Workers do not bundle the Durable Object.",
            allowTypeImports: true,
          },
        ),
      },
    },
  ],
});
