import { Command, CommanderError, InvalidArgumentError } from "@commander-js/extra-typings";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseWholePixels,
  toFidelityCheckEnvironment,
  type FidelityCheckInputs,
} from "#fidelity-check/inputs.ts";

import { readDesignImageSize } from "@cup/fidelity-check";

type CliDependencies = {
  /** Where relative paths start: the directory the command was typed in. */
  workingDirectory: string;
  /** Runs the check with Playwright's own arguments and resolves to its exit code. */
  launch: (inputs: FidelityCheckInputs, playwrightArgs: string[]) => Promise<number>;
  output: { log: (message: string) => void; error: (message: string) => void };
};

const PACKAGE_DIRECTORY = path.resolve(import.meta.dirname, "..");
/** The name of this package's script, which pnpm reports in `npm_lifecycle_event`. */
const SCRIPT_NAME = "fidelity-check";
/** A shell reports a process ended by a signal as 128 plus the signal's number. */
const SIGNAL_EXIT_CODE_BASE = 128;

/**
 * Checks the command's options, then hands them to the Playwright run, which needs Playwright's
 * runner for the gallery server, the Docker browser and the `mount` fixture.
 */
export async function runFidelityCheckCli(
  args: string[],
  { workingDirectory, launch, output }: CliDependencies,
): Promise<number> {
  const program = new Command()
    .name("fidelity-check")
    .description("Compare a story with the design's image")
    .usage("--story <story> --image <path> [--ignore-top <pixels>] [-- <playwright options>]")
    .requiredOption("--story <story>", "the story to render, such as routes/index/LandingPage")
    .requiredOption("--image <path>", "the design's render as a PNG at 1x", (image) =>
      parseDesignImage(path.resolve(workingDirectory, image)),
    )
    .option(
      "--ignore-top <pixels>",
      "rows the app does not draw, such as a device status bar",
      (pixels) => toCommanderArgument(() => parseWholePixels(pixels)),
      0,
    )
    .argument("[playwright-options...]", "options for Playwright, after --, such as --headed")
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
  return launch({ story, designImagePath: image, ignoreTopPixels: ignoreTop }, program.args);
}

/** Pnpm runs the script in this package and names the directory it was typed in as `INIT_CWD`. */
export function findWorkingDirectory(
  environment: Record<string, string | undefined>,
  currentDirectory: string,
): string {
  const initialDirectory = environment["INIT_CWD"];
  return environment["npm_lifecycle_event"] === SCRIPT_NAME && initialDirectory !== undefined
    ? initialDirectory
    : currentDirectory;
}

/** Fails before Playwright starts, so that the error comes with the command's usage. */
function parseDesignImage(designImagePath: string): string {
  return toCommanderArgument(() => {
    if (!fs.existsSync(designImagePath)) {
      throw new Error(`The design image does not exist: ${designImagePath}`);
    }
    if (!fs.statSync(designImagePath).isFile()) {
      throw new Error(`The design image is no file: ${designImagePath}`);
    }
    readDesignImageSize(designImagePath);
    return designImagePath;
  });
}

function toCommanderArgument<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
}

function launchPlaywright(inputs: FidelityCheckInputs, playwrightArgs: string[]): Promise<number> {
  const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
  const child = spawn(
    process.execPath,
    [playwrightCli, "test", "--config", "playwright.fidelity-check.config.ts", ...playwrightArgs],
    {
      cwd: PACKAGE_DIRECTORY,
      stdio: "inherit",
      // oxlint-disable-next-line node/no-process-env -- Playwright and Docker need the caller's environment.
      env: { ...process.env, ...toFidelityCheckEnvironment(inputs) },
    },
  );

  // A signal sent to this process alone, such as a CI timeout's, would otherwise leave Playwright and
  // its gallery server running.
  const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      resolve(code ?? SIGNAL_EXIT_CODE_BASE + (signal === null ? 0 : os.constants.signals[signal]));
    });
  });
}

if (import.meta.main) {
  process.exitCode = await runFidelityCheckCli(process.argv.slice(2), {
    // oxlint-disable-next-line node/no-process-env -- The one way to learn where the command was typed.
    workingDirectory: findWorkingDirectory(process.env, process.cwd()),
    launch: launchPlaywright,
    output: console,
  });
}
