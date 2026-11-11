/* oxlint-disable node/no-process-env -- The script reads the host's Android SDK location and the adb device selection. */
/*
 * Builds the debug app, installs it on the one connected Android device or emulator, and launches
 * it. `.mts` because this package is CommonJS for `capacitor.config.ts`.
 */
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import timers from "node:timers/promises";

const APP_ID = "audio.cup.app";
const MAIN_ACTIVITY = `${APP_ID}/.MainActivity`;
const MOBILE_APP_ROOT = path.resolve(import.meta.dirname, "..");
const ANDROID_PROJECT = path.join(MOBILE_APP_ROOT, "android");
const DEFAULT_SDK_ROOT = path.join(os.homedir(), "Library", "Android", "sdk");
const SECONDS_TO_SURVIVE_LAUNCH = 5;

// The same lookup order as the mobile E2E suite's preflight (`qa/mobile-e2e/src/android/preflight.ts`).
const sdkRoot = process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"] ?? DEFAULT_SDK_ROOT;
const adb = path.join(sdkRoot, "platform-tools", "adb");
if (!fs.existsSync(adb)) {
  fail(
    `adb is missing at ${adb}. Install Android Studio with "Android SDK Platform-Tools", or set ANDROID_HOME to an existing SDK (Android Studio's default is ${DEFAULT_SDK_ROOT}).`,
  );
}

const serial = selectDevice();
console.log(`Deploying to ${serial}.`);

// Gradle reads the SDK from ANDROID_HOME, so no `local.properties` is needed.
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  ANDROID_HOME: sdkRoot,
  ANDROID_SERIAL: serial,
};

runVisible("pnpm", ["exec", "turbo", "run", "turbo:build"], MOBILE_APP_ROOT, environment);
runVisible("pnpm", ["exec", "cap", "sync", "android"], MOBILE_APP_ROOT, environment);
runVisible("./gradlew", ["installDebug", "--console=plain"], ANDROID_PROJECT, environment);

const launchOutput = runCaptured(adb, [
  "-s",
  serial,
  "shell",
  "am",
  "start",
  "-W",
  "-n",
  MAIN_ACTIVITY,
]);
if (!launchOutput.includes("Status: ok")) {
  fail(`Launching ${MAIN_ACTIVITY} failed:\n${launchOutput}`);
}

// A crash at startup ends the process after `am start` already reported success.
await timers.setTimeout(SECONDS_TO_SURVIVE_LAUNCH * 1000);
const pid = childProcess.spawnSync(adb, ["-s", serial, "shell", "pidof", APP_ID], {
  encoding: "utf8",
});
if (pid.status !== 0) {
  fail(
    `${APP_ID} stopped within ${SECONDS_TO_SURVIVE_LAUNCH} seconds of launching. Read the crash with \`adb -s ${serial} logcat -b crash -d\`.`,
  );
}
console.log(
  `${APP_ID} is running on ${serial}. Check that its UI renders, for example with \`adb -s ${serial} exec-out screencap -p > screen.png\`.`,
);

/** Returns the serial of the device to deploy to: `ANDROID_SERIAL` or the only one connected. */
function selectDevice(): string {
  const connected = runCaptured(adb, ["devices"])
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const [serialOfLine, state] = line.trim().split(/\s+/);
      return serialOfLine !== undefined && state === "device" ? [serialOfLine] : [];
    });

  const requested = process.env["ANDROID_SERIAL"];
  if (requested !== undefined) {
    if (!connected.includes(requested)) {
      fail(
        `ANDROID_SERIAL is ${requested}, which is not a connected device. Connected: ${connected.join(", ") || "none"}.`,
      );
    }
    return requested;
  }

  const [only, ...others] = connected;
  if (only === undefined) {
    fail(
      "No Android device is connected. Connect a device with USB debugging enabled or start an emulator, and confirm it is listed by `adb devices`.",
    );
  }
  if (others.length > 0) {
    fail(
      `Several Android devices are connected: ${connected.join(", ")}. Set ANDROID_SERIAL to the one to deploy to.`,
    );
  }
  return only;
}

function runVisible(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = childProcess.spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) {
    fail(`\`${[command, ...args].join(" ")}\` exited with ${String(result.status)}.`);
  }
}

function runCaptured(command: string, args: readonly string[]): string {
  const result = childProcess.spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(
      `\`${[command, ...args].join(" ")}\` exited with ${String(result.status)}.\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
