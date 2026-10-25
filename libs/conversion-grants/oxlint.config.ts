import { defineConfig } from "oxlint";

import { config as repoConfig } from "@cup/config-oxlint/oxlint-base.js";

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

function restrictImports(message: string, groups: string[]) {
  return [
    severity,
    {
      paths: repoPaths,
      patterns: [...repoPatterns, { group: groups, message }],
    },
  ];
}

export default defineConfig({
  extends: [repoConfig],
  rules: {
    "no-restricted-imports": restrictImports(
      "Only `src/index.ts` imports `durable-object/`; import the package interface instead.",
      ["#src/durable-object/**"],
    ),
  },
  overrides: [
    {
      files: ["src/index.ts"],
      rules: {
        "no-restricted-imports": restrictImports(
          "`src/index.ts` reaches the generated migrations only through `storage/`.",
          ["#src/migrations/**"],
        ),
      },
    },
    {
      files: ["src/encoding.ts", "src/time.ts"],
      rules: {
        "no-restricted-imports": restrictImports(
          "The shared helpers import nothing else from the package.",
          ["#src/**"],
        ),
      },
    },
    {
      files: ["src/domain/**"],
      rules: {
        "no-restricted-imports": restrictImports(
          "`domain/` imports only `domain/` and the shared helpers.",
          ["#src/index.ts", "#src/storage/**", "#src/durable-object/**", "#src/migrations/**"],
        ),
      },
    },
    {
      files: ["src/storage/**"],
      rules: {
        "no-restricted-imports": restrictImports(
          "`storage/` imports neither `durable-object/` nor the package interface; the Durable Object calls storage.",
          ["#src/index.ts", "#src/durable-object/**"],
        ),
      },
    },
    {
      files: ["src/durable-object/**"],
      rules: {
        "no-restricted-imports": restrictImports(
          "`durable-object/` reaches the generated migrations only through `storage/`.",
          ["#src/migrations/**"],
        ),
      },
    },
  ],
});
