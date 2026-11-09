import childProcess from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { SYSTEM_IMAGE_PACKAGE, type AndroidHost } from "#src/android/preflight.ts";
import { run, stopChild, waitFor } from "#src/host.ts";

export type Emulator = {
  /** The adb serial, `emulator-<console port>`; every adb call names it. */
  readonly serial: string;
  /** Kills this emulator only; its read-only run leaves the snapshot unchanged. */
  stop(): Promise<void>;
};

/**
 * The suite's own AVD, shared by every checkout on this Mac: runs only read it, so it lives outside
 * the checkout and Android Studio's AVD folder.
 */
const AVD_HOME = path.join(os.homedir(), "Library", "Caches", "cup-mobile-e2e", "avd");
/**
 * Named after its RAM, which its Quick Boot snapshot fixes: a machine with an AVD of another RAM
 * size, such as the earlier 2 GB `cup-mobile-e2e-api36`, creates this one and its snapshot anew.
 */
const AVD_NAME = "cup-mobile-e2e-api36-ram4g";
/**
 * The guest's RAM in MB; the emulator ignores a unit suffix and falls back to the profile's 2048.
 * The Pixel 8 profile's 2 GB drove the guest into constant zram swapping during the full suite
 * until adbd stopped answering (2026-11-09).
 */
const RAM_SIZE = "4096";
/** Written once the Quick Boot snapshot is saved, so an interrupted preparation is redone. */
const SNAPSHOT_READY_MARKER = path.join(AVD_HOME, `${AVD_NAME}.snapshot-ready`);
const PREPARATION_LOCK = path.join(AVD_HOME, `${AVD_NAME}.lock`);

const BOOT_TIMEOUT_MS = 180_000;

/**
 * Boots a headless emulator of the suite's AVD from its Quick Boot snapshot in read-only mode, so
 * concurrent runs can share the AVD. The emulator picks its own console port and reports it.
 */
export async function bootEmulator(host: AndroidHost): Promise<Emulator> {
  await prepareSnapshot(host);
  const { serial, process: emulatorProcess } = await startEmulator(host, ["-read-only"]);

  const stop = async (): Promise<void> => {
    if (emulatorProcess.exitCode === null && emulatorProcess.signalCode === null) {
      // Asks this emulator to quit; never `adb kill-server`, which other runs share.
      await run(host.adb, ["-s", serial, "emu", "kill"]).catch(() => undefined);
      const exited = once(emulatorProcess, "exit");
      const timeout = setTimeout(() => emulatorProcess.kill("SIGKILL"), 15_000);
      await exited;
      clearTimeout(timeout);
    }
  };

  try {
    await waitForBoot(host, serial, emulatorProcess);
  } catch (error) {
    await stop();
    throw error;
  }
  return { serial, stop };
}

/** Creates the AVD and its Quick Boot snapshot once per Mac; later runs find the marker. */
async function prepareSnapshot(host: AndroidHost): Promise<void> {
  await fs.mkdir(AVD_HOME, { recursive: true });
  if (await exists(SNAPSHOT_READY_MARKER)) {
    return;
  }

  await withPreparationLock(async () => {
    if (await exists(SNAPSHOT_READY_MARKER)) {
      return;
    }
    process.stderr.write(
      `Preparing the suite's Android emulator ${AVD_NAME} and its Quick Boot snapshot once for this Mac; this takes a few minutes.\n`,
    );
    await run(
      host.avdManager,
      [
        "create",
        "avd",
        "--force",
        "--name",
        AVD_NAME,
        "--package",
        SYSTEM_IMAGE_PACKAGE,
        "--device",
        "pixel_8",
      ],
      { env: androidEnvironment(host) },
    );
    await setAvdConfig("hw.ramSize", RAM_SIZE);
    const { serial, process: emulatorProcess } = await startEmulator(host, ["-no-snapshot-load"]);
    try {
      await waitForBoot(host, serial, emulatorProcess);
      // Quick Boot saves the snapshot when a writable emulator quits.
      await run(host.adb, ["-s", serial, "emu", "kill"]);
      await waitFor(
        "the emulator to save its snapshot and quit",
        () =>
          Promise.resolve(
            emulatorProcess.exitCode !== null || emulatorProcess.signalCode !== null
              ? true
              : undefined,
          ),
        120_000,
      );
    } finally {
      await stopChild(emulatorProcess);
    }
    await fs.writeFile(SNAPSHOT_READY_MARKER, "");
  });
}

async function startEmulator(
  host: AndroidHost,
  extraArgs: readonly string[],
): Promise<{ serial: string; process: childProcess.ChildProcess }> {
  const report = await listenForConsoleReport();
  const emulatorProcess = childProcess.spawn(
    host.emulator,
    [
      "-avd",
      AVD_NAME,
      "-no-window",
      "-no-audio",
      "-no-boot-anim",
      // The emulator connects here and writes the console port it picked.
      "-report-console",
      `tcp:${report.port}`,
      ...extraArgs,
    ],
    { env: androidEnvironment(host), stdio: ["ignore", "pipe", "pipe"] },
  );
  const output: string[] = [];
  emulatorProcess.stdout?.setEncoding("utf8").on("data", (chunk: string) => output.push(chunk));
  emulatorProcess.stderr?.setEncoding("utf8").on("data", (chunk: string) => output.push(chunk));

  try {
    const consolePort = await Promise.race([
      report.consolePort,
      once(emulatorProcess, "exit").then(() => {
        throw new Error(
          `The emulator exited before it reported its console port.\n${output.join("")}`,
        );
      }),
    ]);
    return { serial: `emulator-${consolePort}`, process: emulatorProcess };
  } catch (error) {
    await stopChild(emulatorProcess);
    throw error;
  } finally {
    report.close();
  }
}

async function listenForConsoleReport(): Promise<{
  port: number;
  consolePort: Promise<number>;
  close(): void;
}> {
  const server = net.createServer();
  const consolePort = new Promise<number>((resolve, reject) => {
    server.on("connection", (socket) => {
      let data = "";
      socket.setEncoding("utf8").on("data", (chunk: string) => (data += chunk));
      socket.on("end", () => {
        const port = Number.parseInt(data.trim(), 10);
        if (Number.isInteger(port)) {
          resolve(port);
        } else {
          reject(new Error(`The emulator reported an invalid console port: ${data}`));
        }
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The operating system assigned no port for the emulator's console report.");
  }
  return { port: address.port, consolePort, close: () => server.close() };
}

async function waitForBoot(
  host: AndroidHost,
  serial: string,
  emulatorProcess: childProcess.ChildProcess,
): Promise<void> {
  await waitFor(
    `${serial} to finish booting`,
    async () => {
      if (emulatorProcess.exitCode !== null) {
        throw new Error(`The emulator ${serial} exited while booting.`);
      }
      const result = await run(host.adb, [
        "-s",
        serial,
        "shell",
        "getprop",
        "sys.boot_completed",
      ]).catch(() => undefined);
      return result?.stdout.trim() === "1" ? true : undefined;
    },
    BOOT_TIMEOUT_MS,
  );
}

/** Sets one key of the AVD's `config.ini`, replacing the value `avdmanager` wrote. */
async function setAvdConfig(key: string, value: string): Promise<void> {
  const configPath = path.join(AVD_HOME, `${AVD_NAME}.avd`, "config.ini");
  const lines = (await fs.readFile(configPath, "utf8"))
    .split("\n")
    .filter((line) => !line.startsWith(`${key} `) && !line.startsWith(`${key}=`));
  await fs.writeFile(
    configPath,
    [...lines.filter((line) => line !== ""), `${key} = ${value}`, ""].join("\n"),
  );
}

/** Serializes snapshot preparation across concurrent runs; a dead holder's lock is taken over. */
async function withPreparationLock(prepare: () => Promise<void>): Promise<void> {
  await waitFor(
    "another run to finish preparing the emulator snapshot",
    async () => {
      try {
        await fs.mkdir(PREPARATION_LOCK);
        await fs.writeFile(path.join(PREPARATION_LOCK, "pid"), String(process.pid));
        return true;
      } catch (error) {
        if (!isErrorWithCode(error, "EEXIST")) {
          throw error;
        }
      }
      const holder = Number.parseInt(
        await fs.readFile(path.join(PREPARATION_LOCK, "pid"), "utf8").catch(() => ""),
        10,
      );
      if (Number.isInteger(holder) && !isProcessAlive(holder)) {
        await fs.rm(PREPARATION_LOCK, { recursive: true, force: true });
      }
      return undefined;
    },
    15 * 60_000,
  );
  try {
    await prepare();
  } finally {
    await fs.rm(PREPARATION_LOCK, { recursive: true, force: true });
  }
}

function androidEnvironment(host: AndroidHost): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANDROID_HOME: host.sdkRoot,
    ANDROID_SDK_ROOT: host.sdkRoot,
    ANDROID_AVD_HOME: AVD_HOME,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrorWithCode(error, "ESRCH");
  }
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}
