import { defineConfig, mergeConfig, type Plugin } from "vite";

import { createWebAppViteConfig, WEB_APP_DIRECTORY } from "@cup/web-app/vite";

const GALLERY_PATH = "ui-gallery/index.html";

/** The server root serves the web app, so point the printed URLs at the gallery page instead. */
function printGalleryUrls(): Plugin {
  return {
    name: "cup:print-gallery-urls",
    apply: "serve",
    configureServer(server) {
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        const { resolvedUrls } = server;
        if (resolvedUrls) {
          server.resolvedUrls = {
            local: resolvedUrls.local.map((url) => new URL(GALLERY_PATH, url).href),
            network: resolvedUrls.network.map((url) => new URL(GALLERY_PATH, url).href),
          };
        }
        printUrls();
      };
    },
  };
}

export default mergeConfig(
  createWebAppViteConfig(),
  defineConfig({
    root: WEB_APP_DIRECTORY,
    plugins: [printGalleryUrls()],
    server: {
      port: 3100,
      strictPort: true,
    },
  }),
);
