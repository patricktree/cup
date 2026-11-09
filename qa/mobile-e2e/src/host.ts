import childProcess from "node:child_process";
import { once } from "node:events";
import net from "node:net";

export type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/** Runs a command to completion and throws with its output when it exits with a non-zero code. */
export async function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const child = childProcess.spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    // A missing executable emits `error` instead of `close`.
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(
      `\`${[command, ...args].join(" ")}\` exited with ${String(exitCode)}.\n${stdout}${stderr}`,
    );
  }
  return { stdout, stderr };
}

/** Asks the operating system for a free port on the loopback interface. */
export async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The operating system assigned no port.");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

/** Polls `check` until it returns a value other than undefined, or throws after `timeoutMs`. */
export async function waitFor<T>(
  description: string,
  check: () => Promise<T | undefined>,
  timeoutMs: number,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) {
      return value;
    }
    if (performance.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Stops a child process with SIGTERM, then SIGKILL after `graceMs`. */
export async function stopChild(child: childProcess.ChildProcess, graceMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), graceMs);
  await exited;
  clearTimeout(timeout);
}
