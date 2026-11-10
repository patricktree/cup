/* oxlint-disable node/no-process-env -- The preflight reads the host's Android SDK and Java locations. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { run } from "#src/host.ts";

/** Paths of the host tools the Android run needs, checked to exist. */
export type AndroidHost = {
  readonly sdkRoot: string;
  readonly adb: string;
  readonly emulator: string;
  readonly avdManager: string;
  /** The value Gradle and Appium get as `JAVA_HOME`, or undefined when `java` comes from `PATH`. */
  readonly javaHome: string | undefined;
};

/** The `sdkmanager` package of the system image the suite's emulator runs. */
export const SYSTEM_IMAGE_PACKAGE = "system-images;android-36;google_apis;arm64-v8a";

const DEFAULT_SDK_ROOT = path.join(os.homedir(), "Library", "Android", "sdk");
const ANDROID_STUDIO_JAVA_HOME = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";

/**
 * Checks that the host has every tool an Android run needs, before any device starts, and fails
 * with every missing tool and its fix rather than skipping the platform.
 */
export async function checkAndroidHost(): Promise<AndroidHost> {
  const problems: string[] = [];

  const sdkRoot =
    process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"] ?? DEFAULT_SDK_ROOT;
  const adb = path.join(sdkRoot, "platform-tools", "adb");
  const emulator = path.join(sdkRoot, "emulator", "emulator");
  const avdManager = path.join(sdkRoot, "cmdline-tools", "latest", "bin", "avdmanager");
  const systemImage = path.join(sdkRoot, ...SYSTEM_IMAGE_PACKAGE.split(";"));

  if (!fs.existsSync(sdkRoot)) {
    problems.push(
      `The Android SDK is missing at ${sdkRoot}. Install Android Studio, or set ANDROID_HOME to an existing SDK (Android Studio's default is ${DEFAULT_SDK_ROOT}).`,
    );
  } else {
    if (!fs.existsSync(adb)) {
      problems.push(
        `adb is missing at ${adb}. Install "Android SDK Platform-Tools" in Android Studio's SDK Manager.`,
      );
    }
    if (!fs.existsSync(emulator)) {
      problems.push(
        `The Android Emulator is missing at ${emulator}. Install "Android Emulator" in Android Studio's SDK Manager.`,
      );
    }
    if (!fs.existsSync(avdManager)) {
      problems.push(
        `avdmanager is missing at ${avdManager}. Install "Android SDK Command-line Tools (latest)" in Android Studio's SDK Manager.`,
      );
    }
    if (!fs.existsSync(systemImage)) {
      const sdkManager = path.join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager");
      problems.push(
        `The system image ${SYSTEM_IMAGE_PACKAGE} is missing. Install it with \`${sdkManager} "${SYSTEM_IMAGE_PACKAGE}"\`.`,
      );
    }
  }

  const javaHome = process.env["JAVA_HOME"];
  const javaVersionProblem = await checkJava21(javaHome);
  if (javaVersionProblem !== undefined) {
    problems.push(
      `${javaVersionProblem} Gradle needs Java 21: set JAVA_HOME to a Java 21 installation, such as Android Studio's ${ANDROID_STUDIO_JAVA_HOME}.`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `The Android run of the mobile E2E suite cannot start:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nSee qa/mobile-e2e/README.md for the prerequisites.`,
    );
  }
  return { sdkRoot, adb, emulator, avdManager, javaHome };
}

async function checkJava21(javaHome: string | undefined): Promise<string | undefined> {
  const java = javaHome === undefined ? "java" : path.join(javaHome, "bin", "java");
  let output: string;
  try {
    // `java -version` writes to stderr.
    output = (await run(java, ["-version"])).stderr;
  } catch {
    return javaHome === undefined
      ? "No Java runtime is on PATH and JAVA_HOME is not set."
      : `JAVA_HOME points to ${javaHome}, which has no working bin/java.`;
  }
  const major = /version "(\d+)/.exec(output)?.[1];
  if (major !== "21") {
    return `${java} is Java ${major ?? "of an unknown version"}.`;
  }
  return undefined;
}
