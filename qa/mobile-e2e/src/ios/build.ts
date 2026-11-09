import path from "node:path";

import { run } from "#src/host.ts";

const MOBILE_APP_ROOT = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "mobile-app",
);
const XCODE_PROJECT_ROOT = path.join(MOBILE_APP_ROOT, "ios", "App");
/** Inside the iOS project's git-ignored `build` folder. */
const DERIVED_DATA = path.join(XCODE_PROJECT_ROOT, "build", "mobile-e2e");

/**
 * Copies the built production web bundle into the iOS project and builds the debug app for the
 * simulator, so a run never tests a stale build. The root `test:e2e:mobile` script builds the web
 * bundle first. Simulator builds need no development team; Xcode signs them ad hoc.
 */
export async function buildIosDebugApp(): Promise<string> {
  await run("pnpm", ["exec", "cap", "sync", "ios"], { cwd: MOBILE_APP_ROOT });
  await run(
    "xcodebuild",
    [
      "-project",
      "App.xcodeproj",
      "-scheme",
      "App",
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      DERIVED_DATA,
      "-quiet",
      "build",
    ],
    { cwd: XCODE_PROJECT_ROOT },
  );
  return path.join(DERIVED_DATA, "Build", "Products", "Debug-iphonesimulator", "App.app");
}
