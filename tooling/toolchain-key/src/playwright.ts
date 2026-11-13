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

// Bounds each Docker call other than the image build, so an unresponsive Docker daemon cannot block
// the run.
const DOCKER_COMMAND_TIMEOUT_MS = 15_000;
// The same bound as the shared configuration's global setup: the build pulls the Playwright base
// image and installs Playwright from npm.
const IMAGE_BUILD_TIMEOUT_MS = 300_000;

const execFile = util.promisify(childProcess.execFile);

/**
 * Reads the Playwright Server image that the shared Playwright configuration runs the browsers in,
 * building it first if it does not exist yet. The image ID changes whenever the image is rebuilt,
 * for example after it was deleted and built again from a newer base image under the same tag.
 */
export async function readPlaywrightToolchainKey(): Promise<PlaywrightToolchainKey> {
  const image = deriveImage();

  return {
    baseImageTag: `mcr.microsoft.com/playwright:v${image.playwrightVersion}-noble`,
    serverImage: { tag: image.tag, id: await readImageId(image) },
  };
}

type ServerImage = { playwrightVersion: string; directory: string; tag: string };

/**
 * Derives the image exactly as `playwright-server-global-setup.ts` of
 * `@patricktree-stack/config-playwright` does: the Playwright version that package resolves, and a
 * hash of the image files. If that derivation changes, the reader builds and keys an image the
 * suite does not use, until this copy is updated; the suite then builds its own image on its first
 * run, and the ID read for the reader's image says nothing about it.
 */
function deriveImage(): ServerImage {
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
    directory: imageDirectory,
    tag: `patricktree-stack/playwright-server:v${playwrightVersion}-${imageFilesHash}`,
  };
}

/**
 * Builds a missing image before reading its ID, so the first run on a machine writes the same key
 * as the runs after it; the suite's global setup then finds the image and builds none. When Docker
 * is stopped or the build fails, the ID is unreadable, so the suite runs and its global setup
 * reports what is wrong.
 */
async function readImageId(image: ServerImage): Promise<string | Unreadable> {
  const inspectArgs = ["image", "inspect", "--format", "{{.Id}}", image.tag];
  return readVersion(`\`docker ${inspectArgs.join(" ")}\``, async () => {
    let id = await inspectImageId(inspectArgs);
    if (id === undefined) {
      // The same build as the global setup's. Concurrent builds, such as the two Playwright suites'
      // readers in one Turbo run, are identical and share BuildKit's layer cache, so they produce the
      // same image.
      await execFile(
        "docker",
        [
          "build",
          "--quiet",
          "--build-arg",
          `PLAYWRIGHT_VERSION=${image.playwrightVersion}`,
          "--tag",
          image.tag,
          image.directory,
        ],
        { timeout: IMAGE_BUILD_TIMEOUT_MS },
      );
      id = await inspectImageId(inspectArgs);
    }
    if (id === undefined || id === "") {
      throw new Error("printed no image ID");
    }
    return id;
  });
}

/** Returns undefined when Docker reports no such image; any other failure throws. */
async function inspectImageId(inspectArgs: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFile("docker", inspectArgs, {
      timeout: DOCKER_COMMAND_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch (error) {
    if (isNoSuchImageError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isNoSuchImageError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    /no such image/i.test(String(error.stderr))
  );
}
