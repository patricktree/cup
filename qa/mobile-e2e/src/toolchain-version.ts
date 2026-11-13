import { readVersion, type Unreadable } from "@cup/toolchain-key/key-file";

import { run } from "#src/host.ts";

export type MacosVersion = { productVersion: string; buildVersion: string };

/** The macOS build both platforms run on; Xcode, the simulators and the emulator depend on it. */
export async function readMacosVersion(): Promise<MacosVersion | Unreadable> {
  return readVersion("sw_vers", async () => ({
    productVersion: (await run("sw_vers", ["-productVersion"])).stdout.trim(),
    buildVersion: (await run("sw_vers", ["-buildVersion"])).stdout.trim(),
  }));
}
