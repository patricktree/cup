import { defineConfig } from "oxlint";

import { config as repoConfig } from "@cup/config-oxlint/oxlint-base.js";

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
});
