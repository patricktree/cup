import { findIosRuntime, readXcodeVersion } from "#src/ios/preflight.ts";
import {
  readMacosVersion,
  readVersion,
  type MacosVersion,
  type Unreadable,
} from "#src/toolchain-version.ts";

/** The host versions an iOS run depends on beyond the repository's files. */
export type IosToolchainKey = {
  xcode: { version: string; buildVersion: string } | Unreadable;
  /** The simulator runtime the preflight picks: the one matching Xcode's simulator SDK. */
  simulatorRuntime: { identifier: string; version: string; buildVersion: string } | Unreadable;
  macos: MacosVersion | Unreadable;
};

export async function readIosToolchainKey(): Promise<IosToolchainKey> {
  const [xcode, simulatorRuntime, macos] = await Promise.all([
    readVersion("xcodebuild -version", readXcodeVersion),
    readVersion("xcrun simctl list runtimes", async () => {
      const { identifier, version, buildVersion } = await findIosRuntime();
      return { identifier, version, buildVersion };
    }),
    readMacosVersion(),
  ]);
  return { xcode, simulatorRuntime, macos };
}
