import { defineConfig } from "oxlint";

import { config as repoConfig } from "@cup/config-oxlint/oxlint-base.js";

type RestrictedImportsPattern = { group: string[]; message: string; allowTypeImports?: boolean };
type RestrictedImportsOptions = { paths?: unknown[]; patterns?: unknown[] };

/*
 * Enforces the import directions between the source folders that AGENTS.md describes. Each entry
 * replaces the repository's `no-restricted-imports` options, so it keeps their paths and patterns
 * and adds its own.
 */
const [severity, ...repoOptions] = (repoConfig.rules?.["no-restricted-imports"] ?? ["error"]) as [
  string,
  ...RestrictedImportsOptions[],
];
const repoPaths = repoOptions.flatMap((options) => options.paths ?? []);
const repoPatterns = repoOptions.flatMap((options) => options.patterns ?? []);

function restrictImports(...patterns: RestrictedImportsPattern[]) {
  return [severity, { paths: repoPaths, patterns: [...repoPatterns, ...patterns] }];
}

const ARTIFACTS_MESSAGE =
  "`artifacts/` runs in the callers' Workers and is reached only through the `./artifact-writer` export.";

export default defineConfig({
  extends: [repoConfig],
  rules: {
    "no-restricted-imports": restrictImports(
      {
        group: ["#src/durable-object/**"],
        message:
          "Only `src/index.ts` imports `durable-object/`; import the package interface instead.",
      },
      { group: ["#src/artifacts/**"], message: ARTIFACTS_MESSAGE },
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
          { group: ["#src/artifacts/**"], message: ARTIFACTS_MESSAGE },
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
          { group: ["#src/artifacts/**"], message: ARTIFACTS_MESSAGE },
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
