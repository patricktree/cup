/* oxlint-disable node/no-process-env -- The harness sanitizes child-process credentials and honors debug flags. */
import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import childProcess from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { startAuthProvider } from "#test-e2e/auth-provider.ts";

type CreatedGrant = {
  grantId: string;
  trialLink: string;
};

export type WorkerEnvironment = {
  origin: string;
  authProvider: Awaited<ReturnType<typeof startAuthProvider>>;
  persistenceDirectory: string;
  createGrant(): Promise<CreatedGrant>;
  restart(scenario: QaScenario): Promise<void>;
};

type QaScenario = "success" | "tts-failure" | "speech-gated" | "preparation-failure";

type Fixtures = {
  expectConsoleError: ((message: string | RegExp) => void) & { messages: Array<string | RegExp> };
  qaScenario: QaScenario;
  workerEnvironment: WorkerEnvironment;
};

export const test = base.extend<Fixtures>({
  expectConsoleError: async ({ browserName: _browserName }, use) => {
    const expectedConsoleErrors: Array<string | RegExp> = [];
    await use(
      Object.assign((message: string | RegExp) => void expectedConsoleErrors.push(message), {
        messages: expectedConsoleErrors,
      }),
    );
  },
  qaScenario: ["success", { option: true }],
  workerEnvironment: async ({ qaScenario }, use, testInfo) => {
    const environment = await createWorkerEnvironment(qaScenario);

    try {
      await use(environment);
    } finally {
      await environment.dispose(testInfo);
    }
  },
  page: async ({ expectConsoleError, page, workerEnvironment }, use, testInfo) => {
    const unexpectedRequests: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === workerEnvironment.origin ||
        url.origin === workerEnvironment.authProvider.origin ||
        url.protocol === "data:" ||
        url.protocol === "blob:"
      ) {
        await route.continue();
        return;
      }

      unexpectedRequests.push(url.href);
      await route.abort("blockedbyclient");
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await use(page);

    await attachText(testInfo, "browser-console-errors", consoleErrors);
    await attachText(testInfo, "browser-page-errors", pageErrors);
    expect(unexpectedRequests, "The browser made an unapproved external request").toEqual([]);
    expect(consoleErrors, "The browser logged an unexpected number of console errors").toHaveLength(
      expectConsoleError.messages.length,
    );
    for (const [index, expectedMessage] of expectConsoleError.messages.entries()) {
      const actualMessage = consoleErrors[index];
      expect(actualMessage, `Unexpected browser console error at index ${index}`).toBeDefined();
      if (typeof expectedMessage === "string") {
        expect(actualMessage).toBe(expectedMessage);
      } else {
        expect(actualMessage).toMatch(expectedMessage);
      }
    }
    expect(pageErrors, "The browser raised page errors").toEqual([]);
  },
});

export { expect } from "@playwright/test";

type InternalWorkerEnvironment = WorkerEnvironment & {
  dispose(testInfo: TestInfo): Promise<void>;
};

async function createWorkerEnvironment(
  initialScenario: QaScenario,
): Promise<InternalWorkerEnvironment> {
  const authProvider = await startAuthProvider();
  const port = await reservePort();
  const inspectorPort = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const persistenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "source-e2e-"));
  const qaRoot = path.resolve(import.meta.dirname, "..");
  const logs: string[] = [];
  let workerProcess: childProcess.ChildProcess | undefined;

  const start = async (scenario: QaScenario): Promise<void> => {
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
        "--inspector-ip",
        "127.0.0.1",
        "--inspector-port",
        inspectorPort.toString(),
        "--persist-to",
        persistenceDirectory,
        "--var",
        `QA_SCENARIO:${scenario}`,
        "--var",
        `SUPABASE_URL:${authProvider.origin}`,
        "--var",
        "SUPABASE_PUBLISHABLE_KEY:qa-key",
        "--var",
        "SUPABASE_SECRET_KEY:qa-admin",
        "--var",
        "GOOGLE_WEB_CLIENT_ID:qa-google-client",
      ],
      { cwd: qaRoot, detached: true, env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    captureProcessOutput(workerProcess, logs);
    await waitUntilReady(origin, workerProcess, logs);
  };

  await start(initialScenario);

  return {
    origin,
    authProvider,
    persistenceDirectory,
    async createGrant() {
      const response = await fetch(`${origin}/api/operator/grants`, {
        method: "POST",
        headers: {
          "Cf-Access-Token": "local-access-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: "Trial", requestId: crypto.randomUUID() }),
      });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      if (
        !isRecord(body) ||
        typeof body["grantId"] !== "string" ||
        typeof body["trialLink"] !== "string"
      ) {
        throw new Error("The local Worker returned an invalid grant creation response");
      }
      return { grantId: body["grantId"], trialLink: body["trialLink"] };
    },
    async restart(scenario) {
      await stopProcess(workerProcess);
      workerProcess = undefined;
      await start(scenario);
    },
    async dispose(currentTestInfo) {
      await stopProcess(workerProcess);
      await authProvider.close();
      await attachText(currentTestInfo, "wrangler-output", logs);
      const didFail = currentTestInfo.status !== currentTestInfo.expectedStatus;
      const shouldRetain = didFail && process.env["E2E_RETAIN_STATE"] === "1";
      if (shouldRetain) {
        await currentTestInfo.attach("retained-worker-state", {
          body: persistenceDirectory,
          contentType: "text/plain",
        });
      } else {
        await fs.rm(persistenceDirectory, { recursive: true, force: true });
      }
    },
  };
}

function captureProcessOutput(process: childProcess.ChildProcess, logs: string[]): void {
  const record = (chunk: string): void => {
    logs.push(chunk);
    if (globalThis.process.env["E2E_STREAM_WRANGLER"] === "1") {
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
      if (response.ok) return;
    } catch {
      // Wrangler has not bound its local port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Wrangler did not become ready.\n${logs.join("")}`);
}

async function stopProcess(process: childProcess.ChildProcess | undefined): Promise<void> {
  if (process === undefined || process.exitCode !== null) return;
  killProcessGroup(process, "SIGTERM");
  const timeout = setTimeout(() => killProcessGroup(process, "SIGKILL"), 10_000);
  await once(process, "exit");
  clearTimeout(timeout);
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

async function reservePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No E2E Worker port.");
  const { port } = address;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

async function attachText(testInfo: TestInfo, name: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  await testInfo.attach(name, { body: lines.join("\n"), contentType: "text/plain" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function gotoPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForFonts(page);
}

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}
