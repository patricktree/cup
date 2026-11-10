import childProcess from "node:child_process";
import crypto from "node:crypto";

import { run } from "#src/host.ts";
import type { IosHost } from "#src/ios/preflight.ts";

export type Simulator = {
  readonly udid: string;
  /** Shuts down and deletes this simulator only. */
  delete(): Promise<void>;
};

/** Every simulator the suite creates is named with this prefix and a random suffix. */
const NAME_PREFIX = "cup-mobile-e2e-";

/**
 * Creates and boots a uniquely named simulator for this run in the default simulator set:
 * WebDriverAgent starts through `xcodebuild`, which sees only the default set. A detached watcher
 * deletes the simulator when this process dies without deleting it, such as when the run is
 * killed.
 */
export async function createSimulator(host: IosHost): Promise<Simulator> {
  const name = `${NAME_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
  const { stdout } = await run("xcrun", [
    "simctl",
    "create",
    name,
    host.deviceTypeIdentifier,
    host.runtime.identifier,
  ]);
  const udid = stdout.trim();
  const watcher = watchForOrphan(udid);

  const deleteSimulator = async (): Promise<void> => {
    // Appium keeps WebDriverAgent's `xcodebuild` running after its session and its own exit.
    await run("pkill", ["-f", xcodebuildPattern(udid)]).catch(() => undefined);
    await run("xcrun", ["simctl", "shutdown", udid]).catch(() => undefined);
    await run("xcrun", ["simctl", "delete", udid]);
    watcher.kill();
  };

  try {
    await run("xcrun", ["simctl", "boot", udid]);
    // Waits until the simulator has finished booting.
    await run("xcrun", ["simctl", "bootstatus", udid]);
  } catch (error) {
    await deleteSimulator();
    throw error;
  }
  return { udid, delete: deleteSimulator };
}

/**
 * Starts a detached shell, outside the run's process group so that Ctrl+C or a killed run leaves it
 * running, which deletes the simulator once this process has exited.
 */
function watchForOrphan(udid: string): childProcess.ChildProcess {
  const watcher = childProcess.spawn(
    "/bin/sh",
    [
      "-c",
      'while kill -0 "${1}" 2>/dev/null; do sleep 1; done; pkill -f "${3}"; xcrun simctl shutdown "${2}"; xcrun simctl delete "${2}"',
      "simulator-watcher",
      String(process.pid),
      udid,
      xcodebuildPattern(udid),
    ],
    { detached: true, stdio: "ignore" },
  );
  watcher.unref();
  return watcher;
}

/**
 * Matches the `xcodebuild` processes that run WebDriverAgent on this simulator only. The bracket
 * keeps the pattern from matching the watcher, whose own arguments contain it.
 */
function xcodebuildPattern(udid: string): string {
  return `[x]codebuild .*-destination id=${udid}`;
}
