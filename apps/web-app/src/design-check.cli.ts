import { Command, CommanderError, InvalidArgumentError } from "@commander-js/extra-typings";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readDesignImageSize } from "@cup/design-check";

/** What `design-check.run.ts` reads from its environment. */
export type DesignCheckInputs = {
  story: string;
  designImagePath: string;
  ignoreTopPixels: number;
};

type CliOptions = {
  /** Where relative paths start: the directory the command was typed in. */
  workingDirectory: string;
  /** Runs the check and resolves to its exit code. */
  launch: (inputs: DesignCheckInputs) => Promise<number>;
  output: { log: (message: string) => void; error: (message: string) => void };
};

const PACKAGE_DIRECTORY = path.resolve(import.meta.dirname, "..");

/**
 * Checks the command's options, then hands them to the Playwright run, which needs Playwright's
 * runner for the gallery server, the Docker browser and the `mount` fixture.
 */
export async function runDesignCheckCli(
  args: string[],
  { workingDirectory, launch, output }: CliOptions,
): Promise<number> {
  const program = new Command()
    .name("design-check")
    .description("Compare a story with the design's image")
    .requiredOption("--story <story>", "the story to render, such as routes/index/LandingPage")
    .requiredOption("--image <path>", "the design's render as a PNG at 1x")
    .option(
      "--ignore-top <pixels>",
      "rows the app does not draw, such as a device status bar",
      parseWholePixels,
      0,
    )
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (message) => output.log(message),
      writeErr: (message) => output.error(message),
    });

  try {
    program.parse(args, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    throw error;
  }

  const { story, image, ignoreTop } = program.opts();
  const designImagePath = path.resolve(workingDirectory, image);
  if (!fs.existsSync(designImagePath)) {
    output.error(`The design image does not exist: ${designImagePath}`);
    return 1;
  }
  // Fails here on an image that is no PNG, before Playwright starts.
  readDesignImageSize(designImagePath);

  return launch({ story, designImagePath, ignoreTopPixels: ignoreTop });
}

function parseWholePixels(value: string): number {
  const pixels = Number(value);
  if (!Number.isInteger(pixels) || pixels < 0) {
    throw new InvalidArgumentError("Expected a whole number of pixels, such as 55.");
  }
  return pixels;
}

function launchPlaywright({
  story,
  designImagePath,
  ignoreTopPixels,
}: DesignCheckInputs): Promise<number> {
  const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
  const child = spawn(
    process.execPath,
    [playwrightCli, "test", "--config", "playwright.design-check.config.ts"],
    {
      cwd: PACKAGE_DIRECTORY,
      stdio: "inherit",
      env: {
        // oxlint-disable-next-line node/no-process-env -- Playwright and Docker need the caller's environment.
        ...process.env,
        DESIGN_CHECK_STORY: story,
        DESIGN_CHECK_IMAGE: designImagePath,
        DESIGN_CHECK_IGNORE_TOP: String(ignoreTopPixels),
      },
    },
  );
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal === null ? 1 : 128)));
  });
}

if (import.meta.main) {
  process.exitCode = await runDesignCheckCli(process.argv.slice(2), {
    // pnpm runs the script in this package, and names the directory it was typed in as INIT_CWD.
    // oxlint-disable-next-line node/no-process-env -- The one way to learn where the command was typed.
    workingDirectory: process.env["INIT_CWD"] ?? process.cwd(),
    launch: launchPlaywright,
    output: console,
  });
}
