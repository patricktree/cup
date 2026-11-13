import fs from "node:fs/promises";
import path from "node:path";

/** A version that could not be read; the cached suite task fails on it before it runs. */
export type Unreadable = { unreadable: string };

/**
 * Reads one version of a toolchain key. A failing read becomes an `Unreadable` naming `source`, so
 * the reader still writes every other version and `assertReadableKeyFile` reports the reason.
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
  return { unreadable: reason };
}

/** Writes a key as formatted JSON, creating the file's directory if needed. */
export async function writeKeyFile(file: string, key: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(key, undefined, 2)}\n`);
}

/**
 * Throws unless `file` is a key file whose every version was read. A cached suite task runs this
 * before its suite, so a pass is never cached under a key that does not describe the toolchain.
 */
export async function assertReadableKeyFile(keyFile: string, suiteName: string): Promise<void> {
  // A suite task runs in its package directory, so a relative path would mislead at the root.
  const file = path.resolve(keyFile);
  const failurePrefix = `The ${suiteName} suite did not start:`;
  const rerunHint =
    "The suite's `turbo:e2e:toolchain` task writes this file before the suite runs; run the suite through its root `pnpm test:e2e:*` script.";

  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new Error(`${failurePrefix} there is no toolchain key file at ${file}. ${rerunHint}`, {
        cause: error,
      });
    }
    throw error;
  }

  let key: unknown;
  try {
    key = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${failurePrefix} the toolchain key file ${file} is not valid JSON (${reason}). ${rerunHint}`,
      { cause: error },
    );
  }

  const unreadableVersions = findUnreadableVersions(key, []);
  if (unreadableVersions.length > 0) {
    throw new Error(
      [
        `${failurePrefix} the toolchain key file ${file} has versions that could not be read:`,
        ...unreadableVersions.map(
          ({ keyPath, reason }) => `  - ${keyPath}: ${reason.trim().replaceAll("\n", "\n    ")}`,
        ),
        "Fix the command or file each reason names, then run the suite again. The key file is rewritten on every run; inspect it with:",
        `  cat ${file}`,
      ].join("\n"),
    );
  }
}

type UnreadableVersion = { keyPath: string; reason: string };

function findUnreadableVersions(value: unknown, keyPath: string[]): UnreadableVersion[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  if ("unreadable" in value && typeof value.unreadable === "string") {
    return [{ keyPath: keyPath.join(".") || "(key)", reason: value.unreadable }];
  }
  return Object.entries(value).flatMap(([name, child]) =>
    findUnreadableVersions(child, [...keyPath, name]),
  );
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
