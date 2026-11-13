import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import url from "node:url";
import util from "node:util";

import { readVersion, type Unreadable } from "#src/key-file.ts";

export type PlaywrightToolchainKey = {
  /** The tag the Playwright Server image is built from; a new Playwright version changes it. */
  baseImageTag: string;
  serverImage: { tag: string; id: string | Unreadable };
};

// Bounds the Docker call so an unresponsive Docker daemon cannot block the run.
const DOCKER_COMMAND_TIMEOUT_MS = 15_000;

const execFile = util.promisify(childProcess.execFile);

/**
 * Reads the Playwright Server image that the shared Playwright configuration runs the browsers in.
 * The image ID changes whenever the image is rebuilt, for example after it was deleted and built
 * again from a newer base image under the same tag.
 */
export async function readPlaywrightToolchainKey(): Promise<PlaywrightToolchainKey> {
  const { playwrightVersion, serverImageTag } = deriveImageTags();

  return {
    baseImageTag: `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`,
    serverImage: { tag: serverImageTag, id: await readImageId(serverImageTag) },
  };
}

/**
 * Derives the tag exactly as `playwright-server-global-setup.ts` of
 * `@patricktree-stack/config-playwright` does: the Playwright version that package resolves, and a
 * hash of the image files. If that derivation changes, the tag names an image that does not exist,
 * so the ID is unreadable and every run misses the cache until this copy is updated.
 */
function deriveImageTags(): { playwrightVersion: string; serverImageTag: string } {
  const configEntry = url.fileURLToPath(
    import.meta.resolve("@patricktree-stack/config-playwright/playwright-docker"),
  );
  const configDirectory = path.dirname(configEntry);

  // Resolved from the shared configuration, as its global setup does; the catalog gives this
  // package's own `@playwright/test` dependency the same version.
  const require = module.createRequire(configEntry);
  const playwrightPackageJson: unknown = require("@playwright/test/package.json");
  if (
    typeof playwrightPackageJson !== "object" ||
    playwrightPackageJson === null ||
    !("version" in playwrightPackageJson) ||
    typeof playwrightPackageJson.version !== "string"
  ) {
    throw new TypeError("@playwright/test/package.json must contain a string version");
  }
  const playwrightVersion = playwrightPackageJson.version;

  const imageDirectory = path.join(configDirectory, "playwright-server-image");
  const hash = crypto.createHash("sha256");
  for (const fileName of ["Dockerfile", "serve.sh"]) {
    hash.update(fs.readFileSync(path.join(imageDirectory, fileName)));
  }
  const imageFilesHash = hash.digest("hex").slice(0, 12);

  return {
    playwrightVersion,
    serverImageTag: `patricktree-stack/playwright-server:v${playwrightVersion}-${imageFilesHash}`,
  };
}

async function readImageId(imageTag: string): Promise<string | Unreadable> {
  const args = ["image", "inspect", "--format", "{{.Id}}", imageTag];
  // The image is built by the suite's first run, so it is absent before that; Docker may also be
  // stopped. Either way the suite has to run, and its global setup reports what is wrong.
  return readVersion(`\`docker ${args.join(" ")}\``, async () => {
    const { stdout } = await execFile("docker", args, { timeout: DOCKER_COMMAND_TIMEOUT_MS });
    const id = stdout.trim();
    if (id === "") {
      throw new Error("printed no image ID");
    }
    return id;
  });
}
