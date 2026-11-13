import fs from "node:fs/promises";
import path from "node:path";

import { readVersion, type Unreadable } from "@cup/toolchain-key/key-file";

import {
  javaExecutable,
  resolveAndroidSdkRoot,
  resolveJavaHome,
  SYSTEM_IMAGE_PACKAGE,
} from "#src/android/preflight.ts";
import { run } from "#src/host.ts";
import { readMacosVersion, type MacosVersion } from "#src/toolchain-version.ts";

type SdkPackageRevision = { package: string; revision: string };

/** The host versions an Android run depends on beyond the repository's files. */
export type AndroidToolchainKey = {
  platformTools: string | Unreadable;
  /** The SDK platform the app compiles against, `compileSdkVersion` in `variables.gradle`. */
  platform: SdkPackageRevision | Unreadable;
  emulator: { revision: string; buildId: string } | Unreadable;
  systemImage: SdkPackageRevision | Unreadable;
  /** The JDK Gradle builds with. */
  java: { runtimeVersion: string; vendor: string } | Unreadable;
  macos: MacosVersion | Unreadable;
};

const PLATFORM_PACKAGE = "platforms;android-36";

export async function readAndroidToolchainKey(): Promise<AndroidToolchainKey> {
  const sdkRoot = resolveAndroidSdkRoot();

  const [platformTools, platform, emulator, systemImage, java, macos] = await Promise.all([
    readVersion(sourcePropertiesPath(sdkRoot, "platform-tools"), async () =>
      requireProperty(await readSourceProperties(sdkRoot, "platform-tools"), "Pkg.Revision"),
    ),
    readPackageRevision(sdkRoot, PLATFORM_PACKAGE),
    readVersion(sourcePropertiesPath(sdkRoot, "emulator"), async () => {
      const properties = await readSourceProperties(sdkRoot, "emulator");
      return {
        revision: requireProperty(properties, "Pkg.Revision"),
        buildId: requireProperty(properties, "Pkg.BuildId"),
      };
    }),
    readPackageRevision(sdkRoot, SYSTEM_IMAGE_PACKAGE),
    readJavaVersion(),
    readMacosVersion(),
  ]);
  return { platformTools, platform, emulator, systemImage, java, macos };
}

async function readPackageRevision(
  sdkRoot: string,
  sdkPackage: string,
): Promise<SdkPackageRevision | Unreadable> {
  return readVersion(sourcePropertiesPath(sdkRoot, sdkPackage), async () => ({
    package: sdkPackage,
    revision: requireProperty(await readSourceProperties(sdkRoot, sdkPackage), "Pkg.Revision"),
  }));
}

async function readJavaVersion(): Promise<AndroidToolchainKey["java"]> {
  const java = javaExecutable(resolveJavaHome());
  return readVersion(`${java} -XshowSettings:properties -version`, async () => {
    // Both the settings and the version go to stderr.
    const { stderr } = await run(java, ["-XshowSettings:properties", "-version"]);
    const properties = parseProperties(stderr, " = ");
    return {
      runtimeVersion: requireProperty(properties, "java.runtime.version"),
      vendor: requireProperty(properties, "java.vendor"),
    };
  });
}

function sourcePropertiesPath(sdkRoot: string, sdkPackage: string): string {
  return path.join(sdkRoot, ...sdkPackage.split(";"), "source.properties");
}

async function readSourceProperties(
  sdkRoot: string,
  sdkPackage: string,
): Promise<Map<string, string>> {
  const text = await fs.readFile(sourcePropertiesPath(sdkRoot, sdkPackage), "utf8");
  return parseProperties(text, "=");
}

function parseProperties(text: string, separator: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const line of text.split("\n")) {
    const separatorIndex = line.indexOf(separator);
    if (separatorIndex !== -1) {
      properties.set(
        line.slice(0, separatorIndex).trim(),
        line.slice(separatorIndex + separator.length).trim(),
      );
    }
  }
  return properties;
}

function requireProperty(properties: Map<string, string>, name: string): string {
  const value = properties.get(name);
  if (value === undefined || value === "") {
    throw new Error(`${name} is missing.`);
  }
  return value;
}
