// Runs the suite: both platforms at once as two Vitest processes, or one platform when the
// arguments name a Vitest project. Other arguments go to Vitest unchanged.
//
// One Vitest process cannot run the platforms at once: it awaits each project's global setup in
// turn, and `fileParallelism: false` puts every spec of both projects into one sequential group.
import childProcess from "node:child_process";
import nodeModule from "node:module";
import path from "node:path";
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";

const PLATFORMS = ["android", "ios"] as const;

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const require = nodeModule.createRequire(import.meta.url);
const VITEST_CLI = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");

const vitestArgs = process.argv.slice(2);
const namesProject = vitestArgs.some((arg) => arg === "--project" || arg.startsWith("--project="));

if (namesProject) {
  const vitest = childProcess.spawn(process.execPath, [VITEST_CLI, "run", ...vitestArgs], {
    cwd: PACKAGE_ROOT,
    stdio: "inherit",
  });
  process.on("SIGTERM", () => vitest.kill("SIGTERM"));
  process.exitCode = await waitForExit(vitest);
} else {
  // Piped output is no terminal, so Vitest would drop its colors.
  const environment = process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env;
  const runs = PLATFORMS.map((platform) => {
    const vitest = childProcess.spawn(
      process.execPath,
      [VITEST_CLI, "run", "--project", platform, ...vitestArgs],
      { cwd: PACKAGE_ROOT, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    prefixLines(vitest.stdout, process.stdout, platform);
    prefixLines(vitest.stderr, process.stderr, platform);
    return { platform, vitest };
  });
  // Ctrl+C reaches both Vitest processes through the terminal's process group; a second SIGINT
  // from here would make Vitest quit without its teardown, which stops the devices.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {
    for (const { vitest } of runs) {
      vitest.kill("SIGTERM");
    }
  });

  const exitCodes = await Promise.all(runs.map(({ vitest }) => waitForExit(vitest)));
  const failedPlatforms = runs
    .filter((_, index) => exitCodes[index] !== 0)
    .map(({ platform }) => platform);
  if (failedPlatforms.length > 0) {
    process.stderr.write(`Mobile E2E failed on ${failedPlatforms.join(" and ")}.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Mobile E2E passed on ${PLATFORMS.join(" and ")}.\n`);
  }
}

/** Copies `input` to `output` line by line, each line preceded by `[<platform>] `. */
function prefixLines(input: Readable, output: Writable, platform: string): void {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => output.write(`[${platform}] ${line}\n`));
}

/** Resolves with the exit code; a process ended by a signal counts as failed. */
async function waitForExit(child: childProcess.ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });
}
