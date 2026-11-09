import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { APPIUM_HOME } from "#src/appium.ts";
import { run } from "#src/host.ts";
import type { IosHost } from "#src/ios/preflight.ts";

/** WebDriverAgent as the installed XCUITest driver bundles it. */
const WEB_DRIVER_AGENT_ROOT = path.join(
  APPIUM_HOME,
  "node_modules",
  "appium-xcuitest-driver",
  "node_modules",
  "appium-webdriveragent",
);
/** Shared by every checkout on this Mac, like the Android emulator's snapshot. */
const CACHE_ROOT = path.join(os.homedir(), "Library", "Caches", "cup-mobile-e2e", "wda");

/**
 * Returns the derived data folder of a WebDriverAgent build for the simulator, building it first
 * when this WebDriverAgent version has not been built with this Xcode on this Mac. Sessions start
 * the build with `xcodebuild test-without-building`, so later runs never rebuild it.
 */
export async function ensureWebDriverAgent(host: IosHost): Promise<string> {
  const packageJson: unknown = JSON.parse(
    await fs.readFile(path.join(WEB_DRIVER_AGENT_ROOT, "package.json"), "utf8"),
  );
  const version =
    typeof packageJson === "object" && packageJson !== null && "version" in packageJson
      ? String(packageJson.version)
      : "unknown";
  const derivedData = path.join(CACHE_ROOT, `${version}-xcode-${host.xcodeBuildVersion}`);
  if (await exists(derivedData)) {
    return derivedData;
  }

  process.stderr.write(
    `Building WebDriverAgent ${version} once for this Mac and Xcode into ${derivedData}; this takes a few minutes.\n`,
  );
  // Concurrent first runs each build into their own folder; the first rename wins.
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  const building = await fs.mkdtemp(`${derivedData}.building-`);
  try {
    await run(
      "xcodebuild",
      [
        "build-for-testing",
        "-project",
        path.join(WEB_DRIVER_AGENT_ROOT, "WebDriverAgent.xcodeproj"),
        "-scheme",
        "WebDriverAgentRunner",
        "-destination",
        "generic/platform=iOS Simulator",
        "-derivedDataPath",
        building,
        "-quiet",
        "GCC_TREAT_WARNINGS_AS_ERRORS=0",
        "COMPILER_INDEX_STORE_ENABLE=NO",
      ],
      { cwd: WEB_DRIVER_AGENT_ROOT },
    );
    await fs.rename(building, derivedData).catch(async (error: unknown) => {
      if (!(await exists(derivedData))) {
        throw error;
      }
    });
  } finally {
    await fs.rm(building, { recursive: true, force: true });
  }
  return derivedData;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}
