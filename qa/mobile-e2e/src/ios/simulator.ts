import childProcess from "node:child_process";
import crypto from "node:crypto";

import { run } from "#src/host.ts";
import type { IosHost } from "#src/ios/preflight.ts";
import {
  isRunOwnerAlive,
  readProcessStartTimes,
  readRunOwner,
  type RunOwner,
  type StartTimeLookup,
} from "#src/run-owner.ts";

export type Simulator = {
  readonly udid: string;
  /** Shuts down and deletes this simulator only. */
  delete(): Promise<void>;
};

/** A simulator as `simctl list` reports it. */
export type ListedSimulator = {
  readonly udid: string;
  readonly name: string;
};

/**
 * Every simulator the suite creates is named with this prefix, the run that owns it and a random
 * suffix, as in `cup-mobile-e2e-<pid>-<started at>-<random>`.
 */
const NAME_PREFIX = "cup-mobile-e2e-";
/**
 * Only names with an owner count: a name without one, from before the owner was part of the name,
 * may belong to a run still going in an older checkout, so the sweep never deletes it.
 */
const OWNED_NAME = /^cup-mobile-e2e-(\d+)-(\d{14})-[\da-f]{8}$/u;

export function simulatorName(owner: RunOwner): string {
  return `${NAME_PREFIX}${owner.pid}-${owner.startedAt}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Picks the suite's simulators whose run no longer runs, which a run killed before its teardown
 * leaves behind. Simulators of runs still going, such as in another checkout, are kept.
 */
export function findOrphanedSimulators(
  simulators: readonly ListedSimulator[],
  startTimeOf: StartTimeLookup,
): string[] {
  return simulators
    .filter(({ name }) => {
      const match = OWNED_NAME.exec(name);
      if (match === null) {
        return false;
      }
      const [, pid, startedAt = ""] = match;
      return !isRunOwnerAlive({ pid: Number(pid), startedAt }, startTimeOf);
    })
    .map(({ udid }) => udid);
}

/**
 * Deletes the simulators that killed runs left behind, after stopping the `xcodebuild` processes
 * that ran WebDriverAgent on them.
 */
export async function deleteOrphanedSimulators(): Promise<void> {
  const [simulators, startTimeOf] = await Promise.all([listSimulators(), readProcessStartTimes()]);
  for (const udid of findOrphanedSimulators(simulators, startTimeOf)) {
    process.stderr.write(`Deleting simulator ${udid}, left behind by a run that no longer runs.\n`);
    await run("pkill", ["-f", xcodebuildPattern(udid)], { successExitCodes: [0, 1] });
    // A simulator that is already shut down makes `shutdown` fail; `delete` then reports real errors.
    await run("xcrun", ["simctl", "shutdown", udid]).catch(() => undefined);
    try {
      await run("xcrun", ["simctl", "delete", udid]);
    } catch (error) {
      // The dead run's watcher may have deleted it in the meantime.
      if ((await listSimulators()).some((simulator) => simulator.udid === udid)) {
        throw error;
      }
    }
  }
}

/**
 * Creates and boots a uniquely named simulator for this run in the default simulator set:
 * WebDriverAgent starts through `xcodebuild`, which sees only the default set. A detached watcher
 * deletes the simulator when this process dies without deleting it, such as when the run is
 * killed.
 */
export async function createSimulator(host: IosHost): Promise<Simulator> {
  const name = simulatorName(await readRunOwner());
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

async function listSimulators(): Promise<ListedSimulator[]> {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "--json"]);
  const listing: unknown = JSON.parse(stdout);
  if (!isRecord(listing) || !isRecord(listing["devices"])) {
    throw new TypeError(`\`simctl list devices --json\` printed no devices: ${stdout}`);
  }
  return Object.values(listing["devices"]).flatMap((devices: unknown): ListedSimulator[] =>
    Array.isArray(devices)
      ? devices.flatMap((device: unknown): ListedSimulator[] =>
          isRecord(device) &&
          typeof device["udid"] === "string" &&
          typeof device["name"] === "string"
            ? [{ udid: device["udid"], name: device["name"] }]
            : [],
        )
      : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
