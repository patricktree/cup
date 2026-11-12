import crypto from "node:crypto";

import { run } from "#src/host.ts";

/** A version that could not be read, made unique so that a task hashing it never hits the cache. */
export type Unreadable = { unreadable: string; nonce: string };

export type MacosVersion = { productVersion: string; buildVersion: string };

/**
 * Reads one version of a toolchain key. A failing read becomes an `Unreadable` naming `source`, so
 * the cached task hashing the key misses and the suite's preflight reports the problem itself.
 */
export async function readVersion<T>(
  source: string,
  read: () => Promise<T>,
): Promise<T | Unreadable> {
  try {
    return await read();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { unreadable: `${source}: ${reason}`, nonce: crypto.randomUUID() };
  }
}

/** The macOS build both platforms run on; Xcode, the simulators and the emulator depend on it. */
export async function readMacosVersion(): Promise<MacosVersion | Unreadable> {
  return readVersion("sw_vers", async () => ({
    productVersion: (await run("sw_vers", ["-productVersion"])).stdout.trim(),
    buildVersion: (await run("sw_vers", ["-buildVersion"])).stdout.trim(),
  }));
}
