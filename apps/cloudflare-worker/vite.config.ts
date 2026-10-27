import { cloudflare } from "@cloudflare/vite-plugin";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, mergeConfig, type Plugin } from "vite";

import { createWebAppViteConfig, WEB_APP_DIRECTORY } from "@cup/web-app/vite";

const WORKER_DIRECTORY = import.meta.dirname;

/**
 * A stale `.env.local` can point at a local Supabase stack that is no longer running; the server
 * would start, and sign-in would fail only later in the browser. Fail at startup instead.
 */
function requireReachableLocalSupabase(mode: string): Plugin {
  return {
    name: "cup:require-reachable-local-supabase",
    apply: "serve",
    async configResolved() {
      const env = loadEnv(mode, WORKER_DIRECTORY, "");
      const supabaseUrl = env["SUPABASE_URL"];
      if (!supabaseUrl) {
        return;
      }
      const { hostname } = new URL(supabaseUrl);
      const isLocal =
        env["LOCAL_DEVELOPMENT"] === "true" ||
        ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
        hostname.endsWith(".ts.net");
      if (!isLocal) {
        return;
      }
      const healthUrl = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/health`;
      const isReachable = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) }).then(
        async (response) => {
          await response.body?.cancel();
          return response.ok;
        },
        () => false,
      );
      if (!isReachable) {
        throw new Error(
          `Local Supabase at ${supabaseUrl} is not reachable (${healthUrl}). Run \`pnpm dev:services\` (or \`pnpm dev:services --tailnet\`) and restart the development server.`,
        );
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const workerConfig = defineConfig({
    envDir: WORKER_DIRECTORY,
    build: { outDir: path.join(WORKER_DIRECTORY, "dist") },
    plugins: [cloudflare({ configPath: path.join(WORKER_DIRECTORY, "wrangler.jsonc") })],
  });

  if (command === "build") {
    const webBundleDirectory = path.join(WEB_APP_DIRECTORY, "dist/web");
    // The web package builds first through Turbo; never deploy without its SPA assets.
    fs.accessSync(path.join(webBundleDirectory, "index.html"));

    return mergeConfig(workerConfig, {
      root: WORKER_DIRECTORY,
      publicDir: webBundleDirectory,
    });
  } else if (command === "serve") {
    return mergeConfig(
      createWebAppViteConfig(),
      mergeConfig(workerConfig, {
        root: WEB_APP_DIRECTORY,
        plugins: [requireReachableLocalSupabase(mode)],
      }),
    );
  }

  return check.assertIsUnreachable(command);
});
