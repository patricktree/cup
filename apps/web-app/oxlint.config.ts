import { defineConfig } from "oxlint";

import { config as repoConfig } from "@cup/config-oxlint/oxlint-base.js";

type RestrictedImportsOptions = { paths?: unknown[]; patterns?: unknown[] };

/*
 * The override entries replace the repository's `no-restricted-imports` options, so they keep their
 * paths and patterns and add their own.
 */
const [severity, ...repoOptions] = (repoConfig.rules?.["no-restricted-imports"] ?? ["error"]) as [
  string,
  ...RestrictedImportsOptions[],
];
const repoPaths = repoOptions.flatMap((options) => options.paths ?? []);
const repoPatterns = repoOptions.flatMap((options) => options.patterns ?? []);

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
        "no-restricted-imports": [
          severity,
          {
            paths: repoPaths,
            patterns: [
              ...repoPatterns,
              {
                group: ["#src/api-client.js"],
                message:
                  "Send API requests through `requestApi` in `src/data-fetching/api-request.ts`, which attaches the account token each call asks for.",
              },
            ],
          },
        ],
      },
    },
    {
      /* The request module itself, and the session machine's own plumbing (auth configuration and
       * media cookie), which runs below account sessions and so cannot go through `requestApi`. */
      files: ["src/data-fetching/api-request.ts", "src/auth/account-session.ts"],
      rules: {
        "no-restricted-imports": [severity, { paths: repoPaths, patterns: repoPatterns }],
      },
    },
  ],
});
