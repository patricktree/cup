import childProcess from "node:child_process";
import nodeModule from "node:module";
import path from "node:path";
import { remote } from "webdriverio";

import { reservePort, run, stopChild, waitFor } from "#src/host.ts";

export type AppiumServer = {
  readonly port: number;
  readonly logs: readonly string[];
  stop(): Promise<void>;
};

/** Whether an app runs and whether it is in the foreground, as `queryAppState` reports it. */
export type AppiumAppState = "not running" | "background" | "foreground";

/** Appium drivers the suite uses, pinned exactly. */
const APPIUM_DRIVERS = {
  uiautomator2: "appium-uiautomator2-driver@8.7.3",
  xcuitest: "appium-xcuitest-driver@12.22.8",
} as const;

export type AppiumDriverName = keyof typeof APPIUM_DRIVERS;

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
/** Package-local and git-ignored, so `pnpm install` never installs drivers. */
export const APPIUM_HOME = path.join(PACKAGE_ROOT, ".appium");
/** The package's own Appium CLI, run by this Node.js so that stopping the child stops Appium. */
// Vitest's module runner does not support `import.meta.resolve`.
const require = nodeModule.createRequire(import.meta.url);
const APPIUM_CLI = path.join(path.dirname(require.resolve("appium/package.json")), "index.js");

/**
 * Installs the drivers into the package-local `APPIUM_HOME` unless the pinned version is already
 * there, then starts one Appium server on a port the operating system assigns.
 */
export async function startAppium(options: {
  drivers: readonly AppiumDriverName[];
  env: NodeJS.ProcessEnv;
}): Promise<AppiumServer> {
  const environment = { ...options.env, APPIUM_HOME };
  for (const driver of options.drivers) {
    await ensureDriver(driver, environment);
  }

  const port = await reservePort();
  const logs: string[] = [];
  const server = childProcess.spawn(
    process.execPath,
    [
      APPIUM_CLI,
      "server",
      "--address",
      "127.0.0.1",
      "--port",
      String(port),
      "--log-no-colors",
      // Downloads the Chromedriver that matches the emulator's WebView.
      "--allow-insecure",
      "uiautomator2:chromedriver_autodownload",
    ],
    { cwd: PACKAGE_ROOT, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.setEncoding("utf8").on("data", (chunk: string) => logs.push(chunk));
  server.stderr.setEncoding("utf8").on("data", (chunk: string) => logs.push(chunk));

  try {
    await waitFor(
      "Appium to start",
      async () => {
        if (server.exitCode !== null) {
          throw new Error(`Appium exited before it became ready.\n${logs.join("")}`);
        }
        const response = await fetch(`http://127.0.0.1:${port}/status`).catch(() => undefined);
        return response?.ok === true ? true : undefined;
      },
      60_000,
    );
  } catch (error) {
    await stopChild(server);
    throw error;
  }
  return { port, logs, stop: () => stopChild(server) };
}

/** Opens a session with `capabilities` on the run's Appium server. */
export async function openAppiumSession(
  appiumPort: number,
  capabilities: WebdriverIO.Capabilities,
): Promise<WebdriverIO.Browser> {
  return remote({
    hostname: "127.0.0.1",
    port: appiumPort,
    logLevel: "warn",
    connectionRetryCount: 0,
    connectionRetryTimeout: 180_000,
    capabilities,
  });
}

/**
 * Maps Appium's `queryAppState` value, the same on both platforms (`XCUIApplicationState` on iOS):
 * 1 not running, 2 suspended, 3 in the background, 4 in the foreground.
 */
export function toAppiumAppState(state: unknown, app: string): AppiumAppState {
  switch (state) {
    case 1:
      return "not running";
    case 2:
    case 3:
      return "background";
    case 4:
      return "foreground";
    default:
      throw new Error(`Unexpected app state of ${app}: ${String(state)}`);
  }
}

async function ensureDriver(
  driver: AppiumDriverName,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const spec = APPIUM_DRIVERS[driver];
  const version = spec.slice(spec.lastIndexOf("@") + 1);
  const { stdout } = await run(
    process.execPath,
    [APPIUM_CLI, "driver", "list", "--installed", "--json"],
    {
      cwd: PACKAGE_ROOT,
      env: environment,
    },
  );
  const installed: unknown = JSON.parse(stdout);
  const installedVersion = getInstalledVersion(installed, driver);
  if (installedVersion === version) {
    return;
  }

  process.stderr.write(`Installing the Appium driver ${spec} into ${APPIUM_HOME}.\n`);
  if (installedVersion !== undefined) {
    await run(process.execPath, [APPIUM_CLI, "driver", "uninstall", driver], {
      cwd: PACKAGE_ROOT,
      env: environment,
    });
  }
  await run(process.execPath, [APPIUM_CLI, "driver", "install", "--source=npm", spec], {
    cwd: PACKAGE_ROOT,
    env: environment,
  });
}

function getInstalledVersion(installed: unknown, driver: string): string | undefined {
  if (typeof installed !== "object" || installed === null || !(driver in installed)) {
    return undefined;
  }
  const entry: unknown = Reflect.get(installed, driver);
  if (typeof entry !== "object" || entry === null || !("version" in entry)) {
    return undefined;
  }
  return typeof entry.version === "string" ? entry.version : undefined;
}
