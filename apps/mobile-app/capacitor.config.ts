const path = require("node:path");

import "@aparajita/capacitor-secure-storage";
import "@capacitor/app";
import type { CapacitorConfig } from "@capacitor/cli";
import "@capawesome/capacitor-google-sign-in";

const pathToWebApp = require.resolve("@cup/web-app/package.json");
const pathToWebAppDist = path.join(pathToWebApp, "..", "./dist/web");

const config: CapacitorConfig = {
  appId: "audio.cup.app",
  appName: "Cup",
  webDir: pathToWebAppDist,
  server: { appStartPath: "/app/" },
  // iOS signs in through the app's own WebAuthentication plugin, so it links no Google SDK. A new
  // plugin the iOS app needs must be added here too, or `cap sync` leaves it out of the iOS app.
  ios: { includePlugins: ["@aparajita/capacitor-secure-storage", "@capacitor/app"] },
  plugins: { CapacitorHttp: { enabled: true }, App: { disableBackButtonHandler: false } },
};

module.exports = config;
