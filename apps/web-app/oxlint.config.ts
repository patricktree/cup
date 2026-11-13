import { defineConfig } from "oxlint";

import { config as repoConfig, restrictImports } from "@cup/config-oxlint/oxlint-base.js";

const API_CLIENT_RESTRICTION = {
  group: ["#src/api-client.js"],
  message:
    "Send API requests through `requestApi` in `src/data-fetching/api-request.ts`, which attaches the account token each call asks for.",
};

export default defineConfig({
  extends: [repoConfig],
  rules: {
    "eslint/no-restricted-globals": [
      "error",
      {
        globals: [
          {
            name: "fetch",
            message:
              "Use ListenerApiClient from @cup/listener-api.client (libs/listener-api.client/src/rpc-client.ts), including its authenticated RPC client for account requests.",
          },
        ],
        checkGlobalObject: true,
      },
    ],
  },
  overrides: [
    {
      files: ["**"],
      rules: {
        "no-restricted-imports": restrictImports(API_CLIENT_RESTRICTION),
      },
    },
    {
      files: ["src/**/*.test.ts"],
      rules: {
        "no-restricted-imports": restrictImports(API_CLIENT_RESTRICTION, {
          group: ["@playwright/test"],
          allowTypeImports: true,
          message:
            "Import `test` and `expect` from `#src/test-utils/component-test.ts`, whose `toHaveScreenshot` requires the `@visual` tag that runs a test in all four browser projects.",
        }),
      },
    },
    {
      /* The request module itself, and the session machine's own plumbing (auth configuration),
       * which runs below account sessions and so cannot go through `requestApi`. */
      files: ["src/data-fetching/api-request.ts", "src/auth/account-session.ts"],
      rules: {
        "no-restricted-imports": restrictImports(),
      },
    },
  ],
});
