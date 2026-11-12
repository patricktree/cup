import fs from "node:fs";
import path from "node:path";
import { defineConfig, mergeConfig, type Plugin } from "vite";

import { createWebAppViteConfig, WEB_APP_DIRECTORY } from "@cup/web-app/vite";

const GALLERY_PATH = "ui-gallery/index.html";
const SOURCE_MODULE_PATTERN = /^\/src\/(?<modulePath>.+)\.tsx?$/;

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

/**
 * Component tests import source modules into the page by the path the development server serves
 * them at, such as `import("/src/platform/share-intake.ts")`, to reach the instance the stories
 * use. The build emits every source module as an entry under the same path with a `.js` extension
 * (`createSourceModuleEntries`), and the preview server answers the `.ts` path with it.
 */
function serveSourceModulesAtTheirPaths(): Plugin {
  return {
    name: "cup:serve-source-modules-at-their-paths",
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? "/", "http://gallery");
        const modulePath = SOURCE_MODULE_PATTERN.exec(url.pathname)?.groups?.["modulePath"];
        if (modulePath !== undefined) {
          request.url = `/src/${modulePath}.js${url.search}`;
        }
        next();
      });
    },
  };
}

/** Every module of `src` that runs in the browser, keyed by its output path without extension. */
function createSourceModuleEntries(): Record<string, string> {
  const sourceFiles = fs.globSync("src/**/*.{ts,tsx}", {
    cwd: WEB_APP_DIRECTORY,
    exclude: ["src/**/*.d.ts", "src/**/*.story.tsx", "src/**/*.test.ts", "src/test-utils/**"],
  });
  return Object.fromEntries(
    sourceFiles.map((sourceFile) => [
      sourceFile.replace(/\.tsx?$/, ""),
      path.join(WEB_APP_DIRECTORY, sourceFile),
    ]),
  );
}

export default mergeConfig(
  createWebAppViteConfig(),
  defineConfig({
    root: WEB_APP_DIRECTORY,
    build: {
      // The component tests serve this build (`playwright.config.ts`).
      outDir: "playwright-output/gallery",
      emptyOutDir: true,
      rolldownOptions: {
        input: {
          gallery: path.join(WEB_APP_DIRECTORY, GALLERY_PATH),
          ...createSourceModuleEntries(),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name.startsWith("src/") ? "[name].js" : "app/assets/[name]-[hash].js",
        },
        // A source module entry keeps every export, which a test may call.
        preserveEntrySignatures: "strict",
      },
    },
    plugins: [printGalleryUrls(), serveSourceModulesAtTheirPaths()],
    server: {
      port: 3100,
      strictPort: true,
    },
  }),
);
