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
  overrides: [
    {
      files: ["src/api-server-environment.ts"],
      rules: {
        "no-restricted-imports": restrictImports(
          "The environment bindings import nothing else from the package.",
          ["#src/**"],
        ),
      },
    },
    {
      files: ["src/http/**"],
      rules: {
        "no-restricted-imports": restrictImports(
          "`http/` does not import the package entry; `src/api-server.ts` composes `http/`.",
          ["#src/api-server.ts"],
        ),
      },
    },
    {
      files: ["src/use-cases/**"],
      rules: {
        "no-restricted-imports": restrictImports(
          "`use-cases/` imports neither `http/` nor the package entry; `http/` calls the use cases.",
          ["#src/api-server.ts", "#src/http/**"],
        ),
      },
    },
    {
      files: ["src/adapters/**"],
      rules: {
        "no-restricted-imports": restrictImports(
          "`adapters/` imports neither `http/`, `use-cases/`, nor the package entry; they call the adapters.",
          ["#src/api-server.ts", "#src/http/**", "#src/use-cases/**"],
        ),
      },
    },
  ],
});
