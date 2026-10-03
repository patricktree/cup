const path = require("node:path");

import "@aparajita/capacitor-secure-storage";
import "@capacitor/app";
import type { CapacitorConfig } from "@capacitor/cli";
import "@capawesome/capacitor-google-sign-in";

const pathToWebApp = require.resolve("@cup/web-app/package.json");
const pathToWebAppDist = path.join(pathToWebApp, "..", "./dist/web");

const config: CapacitorConfig = {
  // Sync each platform separately because Android package names cannot contain hyphens.
  appId:
    process.env["CUP_NATIVE_PLATFORM"] === "android" ? "com.cup_audio.app" : "com.cup-audio.app",
  appName: "Cup",
  webDir: pathToWebAppDist,
  server: { appStartPath: "/app/" },
  plugins: { CapacitorHttp: { enabled: true }, App: { disableBackButtonHandler: false } },
};

module.exports = config;
