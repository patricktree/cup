import { createBaseConfig } from "@patricktree-stack/config-oxfmt/oxfmt-base.js";
import { defineConfig } from "oxfmt";

const baseConfig = createBaseConfig({
  patricktreeStackGitSubmoduleRelativePath: ".patricktree-stack",
});

export default defineConfig({
  ...baseConfig,
  ignorePatterns: [
    ...baseConfig.ignorePatterns,
    "**/worker-configuration.d.ts",
    /* written by the OpenAPI snapshot tests, which compare them byte for byte */
    "libs/*-api.routes/test/__snapshots__/openapi.json",
  ],
  overrides: [
    ...baseConfig.overrides,
    {
      files: ["docs/research/pi-cloudflare-non-streaming-chat-completions.md"],
      options: { proseWrap: "never" },
    },
  ],
  sortImports: {
    customGroups: [
      /* create a group for create-audiobook-from-url packages to separate them from other external dependencies */
      {
        groupName: "create-audiobook-from-url-packages",
        elementNamePattern: ["@cup/**"],
      },
      /* create a group for subpath imports = internal dependencies */
      {
        groupName: "subpath-imports",
        elementNamePattern: ["#src/**"],
      },
      /* create a group for subpath imports for test modules */
      {
        groupName: "subpath-imports-test-modules",
        elementNamePattern: ["#test/**"],
      },
      /* create a group for subpath imports for E2E test modules */
      {
        groupName: "subpath-imports-test-modules-e2e",
        elementNamePattern: ["#test-e2e/**"],
      },
    ],
    groups: [
      ["value-builtin", "type-builtin", "value-external", "type-external"],
      ["value-external", "type-external"],
      ["value-internal", "type-internal"],
      "create-audiobook-from-url-packages",
      "subpath-imports",
      "subpath-imports-test-modules",
      "subpath-imports-test-modules-e2e",
      ["value-parent", "type-parent", "value-sibling", "type-sibling", "value-index", "type-index"],
      "unknown",
    ],
  },
});
