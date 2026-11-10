/* oxlint-disable node/no-process-env -- The harness strips Cloudflare credentials from the Wrangler child process. */
import childProcess from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/** Selects how the test Worker's fakes behave; the Worker entry parses the same values. */
export type TestWorkerScenario = "success" | "tts-failure" | "speech-gated" | "preparation-failure";

export type CreatedGrant = {
  grantId: string;
  trialLink: string;
};

/** A request the test Worker received, as its entry logged it. */
export type RecordedRequest = {
  readonly method: string;
  /** The path with its query string. */
  readonly path: string;
  /** Header names are lowercase. */
  readonly headers: Readonly<Record<string, string>>;
};

export type TestWorker = {
  readonly origin: string;
  readonly persistenceDirectory: string;
  /** Wrangler's output so far, with a line for each start. */
  readonly logs: readonly string[];
  /** Every request the Worker received so far, oldest first, across restarts. */
  requests(): RecordedRequest[];
  /** Creates a conversion grant through the operator API, authorized by the fake access check. */
  createGrant(label?: string): Promise<CreatedGrant>;
  /** Restarts Wrangler with another scenario, keeping the port and persisted storage. */
  restart(scenario: TestWorkerScenario): Promise<void>;
  /** Stops Wrangler and removes the persistence directory unless it is retained. */
  stop(options?: { retainPersistenceDirectory?: boolean }): Promise<void>;
};

type StartTestWorkerOptions = {
  scenario?: TestWorkerScenario;
  /** The fake auth provider the Worker verifies tokens against, if the test signs in. */
  authProviderOrigin?: string;
  /** Writes Wrangler's output to stderr while it runs. */
  streamLogs?: boolean;
  /**
   * Serves HTTPS with this PEM key and certificate instead of HTTP. The caller's own requests, such
   * as the readiness check and grant creation, must trust the certificate, for example through
   * `NODE_EXTRA_CA_CERTS`.
   */
  https?: { keyPath: string; certPath: string };
};

/** Must match the prefix the Worker entry writes in `logRequest`. */
const REQUEST_LOG_PREFIX = "[test-worker:request] ";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Starts one Wrangler process serving the test Worker and the built web app, on a port the
 * operating system assigns and with its own persistence directory.
 */
export async function startTestWorker(options: StartTestWorkerOptions = {}): Promise<TestWorker> {
  const port = await reservePort();
  const inspectorPort = await reservePort();
  const origin = `${options.https === undefined ? "http" : "https"}://127.0.0.1:${port}`;
  const persistenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cup-test-worker-"));
  const logs: string[] = [];
  let workerProcess: childProcess.ChildProcess | undefined;

  const start = async (scenario: TestWorkerScenario): Promise<void> => {
    const environment = { ...process.env };
    delete environment["CLOUDFLARE_API_KEY"];
    delete environment["CLOUDFLARE_API_TOKEN"];
    delete environment["CLOUDFLARE_ACCOUNT_ID"];
    environment["WRANGLER_SEND_METRICS"] = "false";
    logs.push(`Starting Wrangler scenario ${scenario}.`);
    workerProcess = childProcess.spawn(
      "pnpm",
      [
        "exec",
        "wrangler",
        "dev",
        "--config",
        "wrangler.jsonc",
        "--ip",
        "127.0.0.1",
        "--port",
        port.toString(),
        ...(options.https === undefined
          ? []
          : [
              "--local-protocol",
              "https",
              "--https-key-path",
              options.https.keyPath,
              "--https-cert-path",
              options.https.certPath,
            ]),
        "--inspector-ip",
        "127.0.0.1",
        "--inspector-port",
        inspectorPort.toString(),
        "--persist-to",
        persistenceDirectory,
        "--var",
        `QA_SCENARIO:${scenario}`,
        ...(options.authProviderOrigin === undefined
          ? []
          : ["--var", `SUPABASE_URL:${options.authProviderOrigin}`]),
      ],
      { cwd: PACKAGE_ROOT, detached: true, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    captureProcessOutput(workerProcess, logs, options.streamLogs ?? false);
    await waitUntilReady(origin, workerProcess, logs);
  };

  await start(options.scenario ?? "success");

  return {
    origin,
    persistenceDirectory,
    logs,
    requests: () => parseRequestLog(logs),
    createGrant: (label = "Trial") => createGrant(origin, label),
    async restart(scenario) {
      await stopProcess(workerProcess);
      workerProcess = undefined;
      await start(scenario);
    },
    async stop(stopOptions = {}) {
      await stopProcess(workerProcess);
      workerProcess = undefined;
      if (stopOptions.retainPersistenceDirectory !== true) {
        await fs.rm(persistenceDirectory, { recursive: true, force: true });
      }
    },
  };
}

function parseRequestLog(logs: readonly string[]): RecordedRequest[] {
  return logs
    .join("")
    .split("\n")
    .flatMap((line) => {
      const start = line.indexOf(REQUEST_LOG_PREFIX);
      if (start === -1) {
        return [];
      }
      const entry: unknown = JSON.parse(line.slice(start + REQUEST_LOG_PREFIX.length));
      if (
        !isRecord(entry) ||
        typeof entry["method"] !== "string" ||
        typeof entry["path"] !== "string" ||
        !isRecord(entry["headers"])
      ) {
        throw new Error(`The test Worker logged an invalid request: ${line}`);
      }
      const headers = Object.fromEntries(
        Object.entries(entry["headers"]).filter(
          (header): header is [string, string] => typeof header[1] === "string",
        ),
      );
      return [{ method: entry["method"], path: entry["path"], headers }];
    });
}

async function createGrant(origin: string, label: string): Promise<CreatedGrant> {
  const response = await fetch(`${origin}/api/operator/grants`, {
    method: "POST",
    headers: {
      "Cf-Access-Token": "local-access-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ label, requestId: crypto.randomUUID() }),
  });
  if (response.status !== 201) {
    throw new Error(`The test Worker answered grant creation with ${response.status}.`);
  }
  const body: unknown = await response.json();
  if (
    !isRecord(body) ||
    typeof body["grantId"] !== "string" ||
    typeof body["trialLink"] !== "string"
  ) {
    throw new Error("The test Worker returned an invalid grant creation response.");
  }
  return { grantId: body["grantId"], trialLink: body["trialLink"] };
}

function captureProcessOutput(
  process: childProcess.ChildProcess,
  logs: string[],
  streamLogs: boolean,
): void {
  const record = (chunk: string): void => {
    logs.push(chunk);
    if (streamLogs) {
      globalThis.process.stderr.write(chunk);
    }
  };
  process.stdout?.setEncoding("utf8").on("data", record);
  process.stderr?.setEncoding("utf8").on("data", record);
}

async function waitUntilReady(
  origin: string,
  process: childProcess.ChildProcess,
  logs: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Wrangler exited before it became ready.\n${logs.join("")}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) {
        return;
      }
    } catch {
      // Wrangler has not bound its local port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Wrangler did not become ready.\n${logs.join("")}`);
}

async function stopProcess(process: childProcess.ChildProcess | undefined): Promise<void> {
  if (process === undefined || process.exitCode !== null) {
    return;
  }
  killProcessGroup(process, "SIGTERM");
  const timeout = setTimeout(() => killProcessGroup(process, "SIGKILL"), 10_000);
  await once(process, "exit");
  clearTimeout(timeout);
}

function killProcessGroup(process: childProcess.ChildProcess, signal: NodeJS.Signals): void {
  if (process.pid === undefined || process.exitCode !== null) {
    return;
  }
  try {
    globalThis.process.kill(-process.pid, signal);
  } catch (error) {
    if (!isNoSuchProcessError(error)) {
      throw error;
    }
  }
}

function isNoSuchProcessError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

async function reservePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("No test Worker port.");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
