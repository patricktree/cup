import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { afterEach, expect, test } from "vitest";

import { assertReadableKeyFile, readVersion, writeKeyFile } from "#src/key-file.ts";

const CLI = url.fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("passes a key file whose every version was read", async () => {
  const keyFile = path.join(await makeTemporaryDirectory(), "ios.json");
  await writeKeyFile(keyFile, {
    xcode: { version: "27.2", buildVersion: "27C5" },
    macos: { productVersion: "27.2", buildVersion: "26C1" },
  });

  await expect(assertReadableKeyFile(keyFile, "iOS mobile E2E")).resolves.toBeUndefined();
});

test("writes an unreadable version as its reason alone, so the key is the same on every run", async () => {
  const first = await readVersion("`xcodebuild -version`", readMissingXcode);
  const second = await readVersion("`xcodebuild -version`", readMissingXcode);

  expect(first).toEqual({ unreadable: "`xcodebuild -version`: no Xcode at /nonexistent" });
  expect(second).toEqual(first);
});

test("fails a key file with unreadable versions, naming the suite, the file and every reason", async () => {
  const keyFile = path.join(await makeTemporaryDirectory(), "android.json");
  await writeKeyFile(keyFile, {
    platformTools: "37.0.0",
    emulator: { unreadable: "emulator/source.properties: ENOENT" },
    systemImage: { package: "system-images;android-36", revision: { unreadable: "no image" } },
    java: { unreadable: "`java -version`: spawn java ENOENT" },
  });

  const message = await assertReadableKeyFile(keyFile, "Android mobile E2E").then(
    () => "passed",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

  expect(message).toContain("Android mobile E2E");
  expect(message).toContain(keyFile);
  expect(message).toContain("emulator: emulator/source.properties: ENOENT");
  expect(message).toContain("systemImage.revision: no image");
  expect(message).toContain("java: `java -version`: spawn java ENOENT");
  expect(message).not.toContain("platformTools");
});

test("fails when the key file is missing", async () => {
  const keyFile = path.join(await makeTemporaryDirectory(), "playwright.json");

  await expect(assertReadableKeyFile(keyFile, "app E2E")).rejects.toThrow(
    new RegExp(`app E2E.*no toolchain key file at ${escapeRegExp(keyFile)}`, "s"),
  );
});

test("fails when the key file holds no valid JSON", async () => {
  const keyFile = path.join(await makeTemporaryDirectory(), "playwright.json");
  await fs.writeFile(keyFile, '{ "baseImageTag": ');

  await expect(assertReadableKeyFile(keyFile, "app E2E")).rejects.toThrow(
    new RegExp(`app E2E.*toolchain key file ${escapeRegExp(keyFile)} is not valid JSON`, "s"),
  );
});

test("the check command exits non-zero with the reasons, and zero for a readable key", async () => {
  const directory = await makeTemporaryDirectory();
  const unreadableKeyFile = path.join(directory, "unreadable.json");
  const readableKeyFile = path.join(directory, "readable.json");
  await writeKeyFile(unreadableKeyFile, { serverImage: { id: { unreadable: "Docker is down" } } });
  await writeKeyFile(readableKeyFile, { serverImage: { id: "sha256:abc" } });

  const failure = childProcess.spawnSync(
    process.execPath,
    [CLI, "check", unreadableKeyFile, "--suite", "app E2E"],
    { encoding: "utf8" },
  );
  const success = childProcess.spawnSync(
    process.execPath,
    [CLI, "check", readableKeyFile, "--suite", "app E2E"],
    { encoding: "utf8" },
  );

  expect(failure.status).toBe(1);
  expect(failure.stderr).toContain("serverImage.id: Docker is down");
  expect(success.status).toBe(0);
});

async function readMissingXcode(): Promise<never> {
  throw new Error("no Xcode at /nonexistent");
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toolchain-key-file-"));
  directories.push(directory);
  return directory;
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
