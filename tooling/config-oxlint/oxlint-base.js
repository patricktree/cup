// @ts-check

/** @type {import("oxlint").DummyRuleMap} */

import { config as baseConfig } from "@patricktree-stack/config-oxlint/oxlint-base.js";
import { defineConfig } from "oxlint";

/** @typedef {{ group: string[]; message: string; allowTypeImports?: boolean }} RestrictedImportsPattern */

const noRestrictedGlobalsRule = baseConfig.rules?.["no-restricted-globals"];
const noRestrictedImports = baseConfig.rules?.["no-restricted-imports"];

export const config = defineConfig({
  extends: [baseConfig],
  rules: {
    "no-restricted-globals": [
      ...(noRestrictedGlobalsRule ?? ["error"]),
      {
        name: "HTMLRewriter",
        message:
          "Use `parse5` instead. `HTMLRewriter` is not easily polyfillable in Node.js and will be unavailable in Node.js Vitest tests, even if the production runtime provides it (e.g. Cloudflare Workers or Bun).",
      },
    ],
    "no-restricted-imports": [
      ...(noRestrictedImports ?? ["error"]),
      {
        paths: [
          {
            name: "@tanstack/react-query",
            importNames: ["useQuery"],
            message: "Use `useSuspenseQuery` instead.",
          },
        ],
        patterns: [
          {
            group: ["./**", "../**"],
            message: "Use subpath imports (`#src/*`, `#test/*`, ...) instead of relative imports.",
          },
        ],
      },
    ],
  },
});

const [restrictedImportsSeverity, ...repoRestrictedImports] =
  /** @type {[import("oxlint").AllowWarnDeny, ...{ paths?: unknown[]; patterns?: unknown[] }[]]} */ (
    config.rules?.["no-restricted-imports"] ?? ["error"]
  );

/**
 * Returns `no-restricted-imports` options with the repository's paths and patterns plus `patterns`.
 * A package config or override that sets `no-restricted-imports` replaces the repository's options
 * instead of merging with them, so the helper adds them back ahead of the given patterns.
 *
 * @param {...RestrictedImportsPattern} patterns
 * @returns {import("oxlint").DummyRule}
 */
export function restrictImports(...patterns) {
  return [
    restrictedImportsSeverity,
    {
      paths: repoRestrictedImports.flatMap((options) => options.paths ?? []),
      patterns: [
        ...repoRestrictedImports.flatMap((options) => options.patterns ?? []),
        ...patterns,
      ],
    },
  ];
}
