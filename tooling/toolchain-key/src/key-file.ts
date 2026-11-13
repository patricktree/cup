import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** A version that could not be read, made unique so that a task hashing it never hits the cache. */
export type Unreadable = { unreadable: string; nonce: string };

/**
 * Reads one version of a toolchain key. A failing read becomes an `Unreadable` naming `source`, so
 * the cached task hashing the key misses and the suite reports the problem itself.
 */
export async function readVersion<T>(
  source: string,
  read: () => Promise<T>,
): Promise<T | Unreadable> {
  try {
    return await read();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return unreadable(`${source}: ${reason}`);
  }
}

export function unreadable(reason: string): Unreadable {
  return { unreadable: reason, nonce: crypto.randomUUID() };
}

/** Writes a key as formatted JSON, creating the file's directory if needed. */
export async function writeKeyFile(file: string, key: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(key, undefined, 2)}\n`);
}
