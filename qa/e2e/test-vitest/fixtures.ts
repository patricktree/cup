import childProcess from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

export type WorkerEnvironment = {
  readonly origin: string;
  createTrial(): Promise<{ grantId: string; credential: string }>;
};

export function useWorkerEnvironment(): WorkerEnvironment {
  const root = path.resolve(import.meta.dirname, "../../..");
  const qaRoot = path.join(root, "qa/e2e");
  let worker: childProcess.ChildProcess | undefined;
  let persistenceDirectory: string | undefined;
  let origin: string;

  beforeAll(async () => {
    const port = await reservePort();
    const inspectorPort = await reservePort();
    origin = `http://127.0.0.1:${port}`;
    persistenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "trial-link-worker-"));
    worker = childProcess.spawn(
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
        "--inspector-ip",
        "127.0.0.1",
        "--inspector-port",
        inspectorPort.toString(),
        "--persist-to",
        persistenceDirectory,
      ],
      { cwd: qaRoot, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitUntilReady(origin, worker);
  }, 30_000);

  afterAll(async () => {
    if (worker !== undefined && worker.exitCode === null) {
      killProcessGroup(worker, "SIGTERM");
      await new Promise<void>((resolve) => worker?.once("exit", () => resolve()));
    }
    if (persistenceDirectory !== undefined)
      await fs.rm(persistenceDirectory, { recursive: true, force: true });
  });

  return {
    get origin() {
      return origin;
    },
    createTrial() {
      return createTrial(origin);
    },
  };
}

async function reservePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No Worker test port.");
  const { port } = address;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

async function waitUntilReady(url: string, process: childProcess.ChildProcess): Promise<void> {
  let stderr = "";
  process.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Wrangler exited early.\n${stderr}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Wrangler has not bound its local port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Wrangler did not start.\n${stderr}`);
}

function killProcessGroup(process: childProcess.ChildProcess, signal: NodeJS.Signals): void {
  if (process.pid === undefined || process.exitCode !== null) return;
  try {
    globalThis.process.kill(-process.pid, signal);
  } catch (error) {
    if (!isNoSuchProcessError(error)) throw error;
  }
}

function isNoSuchProcessError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

async function createTrial(origin: string): Promise<{ grantId: string; credential: string }> {
  const response = await fetch(`${origin}/api/operator/grants`, {
    method: "POST",
    headers: { "Cf-Access-Token": "local-access-token", "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Native auth test", requestId: crypto.randomUUID() }),
  });
  expect(response.status).toBe(201);
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("grantId" in body) ||
    typeof body.grantId !== "string" ||
    !("trialLink" in body) ||
    typeof body.trialLink !== "string"
  ) {
    throw new Error("Invalid grant creation response");
  }
  const credential = new URLSearchParams(new URL(body.trialLink).hash.slice(1)).get("credential");
  if (credential === null) throw new Error("Missing trial credential");
  return { grantId: body.grantId, credential };
}
