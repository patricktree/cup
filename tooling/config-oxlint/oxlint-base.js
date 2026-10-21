// @ts-check

/** @type {import("oxlint").DummyRuleMap} */

import { config as baseConfig } from "@patricktree-stack/config-oxlint/oxlint-base.js";
import { defineConfig } from "oxlint";

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
