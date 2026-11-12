import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import util from "node:util";
import { afterEach, expect, test } from "vitest";

const CLI = url.fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const execFile = util.promisify(childProcess.execFile);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("writes a different key on every run when the Playwright Server image cannot be read", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toolchain-key-"));
  directories.push(directory);
  const keyFile = path.join(directory, "nested", "playwright.json");
  // A Docker daemon that cannot be reached, as when Docker Desktop is not running.
  const env = { ...process.env, DOCKER_HOST: `unix://${path.join(directory, "no-docker.sock")}` };

  await execFile(process.execPath, [CLI, "playwright", "--output", keyFile], { env });
  const firstKey = await fs.readFile(keyFile, "utf8");
  await execFile(process.execPath, [CLI, "playwright", "--output", keyFile], { env });
  const secondKey = await fs.readFile(keyFile, "utf8");

  expect(firstKey).not.toBe(secondKey);
  expect(JSON.parse(firstKey)).toMatchObject({
    baseImageTag: expect.stringMatching(/^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble$/),
    serverImage: {
      tag: expect.stringMatching(
        /^patricktree-stack\/playwright-server:v\d+\.\d+\.\d+-[0-9a-f]{12}$/,
      ),
      id: { unreadable: expect.stringContaining("docker image inspect") },
    },
  });
});
