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

test("writes the reason as the image ID, the same on every run, when the Playwright Server image cannot be read", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toolchain-key-"));
  directories.push(directory);
  const keyFile = path.join(directory, "nested", "playwright.json");
  // A Docker daemon that cannot be reached, as when Docker Desktop is not running.
  const env = { ...process.env, DOCKER_HOST: `unix://${path.join(directory, "no-docker.sock")}` };

  await execFile(process.execPath, [CLI, "playwright", "--output", keyFile], { env });
  const firstKey = await fs.readFile(keyFile, "utf8");
  await execFile(process.execPath, [CLI, "playwright", "--output", keyFile], { env });
  const secondKey = await fs.readFile(keyFile, "utf8");

  expect(secondKey).toBe(firstKey);
  expect(JSON.parse(firstKey)).toStrictEqual({
    baseImageTag: expect.stringMatching(/^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble$/),
    serverImage: {
      tag: expect.stringMatching(
        /^patricktree-stack\/playwright-server:v\d+\.\d+\.\d+-[0-9a-f]{12}$/,
      ),
      id: { unreadable: expect.stringContaining("docker image inspect") },
    },
  });
});

test("builds a missing Playwright Server image, so the first run writes the same key as the next", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toolchain-key-"));
  directories.push(directory);
  const keyFile = path.join(directory, "playwright.json");
  const buildLog = path.join(directory, "builds.log");
  const binDirectory = path.join(directory, "bin");
  await writeFakeDocker(binDirectory);
  const env = {
    ...process.env,
    PATH: `${binDirectory}${path.delimiter}${process.env["PATH"] ?? ""}`,
    FAKE_DOCKER_BUILT_IMAGE: path.join(directory, "built-image"),
    FAKE_DOCKER_BUILD_LOG: buildLog,
  };

  await execFile(process.execPath, [CLI, "playwright", "--output", keyFile], { env });
  const firstKey = await fs.readFile(keyFile, "utf8");
  await execFile(process.execPath, [CLI, "playwright", "--output", keyFile], { env });
  const secondKey = await fs.readFile(keyFile, "utf8");

  expect(secondKey).toBe(firstKey);
  expect(JSON.parse(firstKey)).toMatchObject({
    serverImage: { id: "sha256:built-by-fake-docker" },
  });
  const builds = (await fs.readFile(buildLog, "utf8")).trim().split("\n");
  expect(builds).toHaveLength(1);
  expect(builds[0]).toMatch(
    /^build --quiet --build-arg PLAYWRIGHT_VERSION=\d+\.\d+\.\d+ --tag patricktree-stack\/playwright-server:v\d+\.\d+\.\d+-[0-9a-f]{12} \S+playwright-server-image$/,
  );
});

/**
 * A `docker` that knows no image until `docker build` runs and then reports one fixed image ID, as
 * Docker does for an image the machine has not built yet.
 */
async function writeFakeDocker(binDirectory: string): Promise<void> {
  await fs.mkdir(binDirectory, { recursive: true });
  const docker = path.join(binDirectory, "docker");
  await fs.writeFile(
    docker,
    [
      "#!/bin/sh",
      'if [ "$1" = "build" ]; then',
      '  echo "$*" >> "${FAKE_DOCKER_BUILD_LOG}"',
      '  touch "${FAKE_DOCKER_BUILT_IMAGE}"',
      "  exit 0",
      "fi",
      'if [ -f "${FAKE_DOCKER_BUILT_IMAGE}" ]; then',
      "  echo sha256:built-by-fake-docker",
      "  exit 0",
      "fi",
      'echo "Error response from daemon: No such image: ${6}" >&2',
      "exit 1",
      "",
    ].join("\n"),
  );
  await fs.chmod(docker, 0o755);
}
