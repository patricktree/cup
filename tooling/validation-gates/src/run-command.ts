import childProcess from "node:child_process";
import path from "node:path";
import process from "node:process";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  /** Stdout and stderr interleaved, for error messages. */
  output: string;
};

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Runs a command from the repository root without a shell. With `isOutputCaptured`, its output is
 * collected; otherwise it goes straight to this process's terminal. A command that cannot start,
 * such as a missing binary, resolves with exit code 127 instead of throwing.
 */
export function runCommand(
  command: [string, ...string[]],
  {
    env = process.env,
    isOutputCaptured = true,
  }: { env?: NodeJS.ProcessEnv; isOutputCaptured?: boolean } = {},
): Promise<CommandResult> {
  const [executable, ...args] = command;

  return new Promise((resolve) => {
    let stdout = "";
    let output = "";
    const child = childProcess.spawn(executable, args, {
      cwd: REPOSITORY_ROOT,
      env,
      stdio: isOutputCaptured ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ exitCode: 127, stdout, output: output + error.message });
    });
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode: exitCode ?? (signal === null ? 1 : 128), stdout, output });
    });
  });
}
