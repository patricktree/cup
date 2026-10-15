import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import wyw from "@wyw-in-js/vite";
import path from "node:path";
import url from "node:url";
import { defineConfig } from "vite";

import { WEB_APP_CSP_NONCE_PLACEHOLDER } from "@cup/listener-api.routes/web-app-csp";

export const WEB_APP_DIRECTORY = url.fileURLToPath(new URL("./", import.meta.url));
const WYW_CONFIG_FILE = url.fileURLToPath(
  import.meta.resolve("@patricktree-stack/config-wyw-in-js/wyw-in-js.config.cjs"),
);

export function createWebAppViteConfig() {
  return defineConfig({
    build: { assetsDir: "app/assets" },
    html: { cspNonce: WEB_APP_CSP_NONCE_PLACEHOLDER },
    publicDir: path.join(WEB_APP_DIRECTORY, "public"),
    plugins: [
      tanstackRouter({
        // The app typechecks with `moduleResolution: node16`, which cannot resolve extensionless imports; the generated tree carries `@ts-nocheck`, so unresolved route imports would silently degrade every route type to `any`.
        addExtensions: ".js",
        autoCodeSplitting: true,
        generatedRouteTree: path.join(WEB_APP_DIRECTORY, "src/routeTree.gen.ts"),
        routesDirectory: path.join(WEB_APP_DIRECTORY, "src/routes"),
        routeFileIgnorePattern: "\\.(story|test)\\.[jt]sx?$",
        target: "react",
      }),
      wyw({
        configFile: WYW_CONFIG_FILE,
        keepComments: true,
      }),
      react(),
    ],
    server: {
      allowedHosts: [
        /* patricktree tailscale domain */
        ".oberhasli-universe.ts.net",
      ],
      host: "127.0.0.1",
    },
  });
}
