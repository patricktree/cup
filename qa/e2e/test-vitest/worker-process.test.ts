import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const qaRoot = path.join(root, "qa/e2e");
let worker: ChildProcess | undefined;
let persistenceDirectory: string | undefined;
let origin: string;

beforeAll(async () => {
  const port = await reservePort();
  origin = `http://127.0.0.1:${port}`;
  persistenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "trial-link-worker-"));
  worker = spawn(
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

test("rejects cross-origin browser mutations before they reach the grant", async () => {
  const response = await fetch(`${origin}/api/grants/${crypto.randomUUID()}/conversions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      Origin: "https://example.com",
      "X-Create-Audiobook-From-URL-Request": "1",
    },
    body: JSON.stringify({ sourceUrl: "https://example.com/source" }),
  });
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ error: { code: "origin-forbidden" } });
});

test("returns 405 and Allow for unsupported methods on known API routes", async () => {
  const response = await fetch(`${origin}/api/grants/${crypto.randomUUID()}`, { method: "POST" });
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET");
  await expect(response.json()).resolves.toMatchObject({ error: { code: "method-not-allowed" } });
});

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

async function waitUntilReady(url: string, process: ChildProcess): Promise<void> {
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

function killProcessGroup(process: ChildProcess, signal: NodeJS.Signals): void {
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

test("updates only the selected grant allowance through the authenticated operator API", async () => {
  const headers = { "Content-Type": "application/json", "Cf-Access-Token": "local-access-token" };
  const response = await fetch(`${origin}/api/operator/grants`, {
    method: "POST",
    headers,
    body: JSON.stringify({ label: "Allowance test", requestId: crypto.randomUUID() }),
  });
  expect(response.status).toBe(201);
  const created: unknown = await response.json();
  if (
    typeof created !== "object" ||
    created === null ||
    !("grantId" in created) ||
    typeof created.grantId !== "string"
  )
    throw new Error("Grant creation did not return an ID");
  const url = `${origin}/api/operator/grants/${created.grantId}/allowance`;
  expect(
    (
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowanceMilliseconds: 20 }),
      })
    ).status,
  ).toBe(401);
  for (const allowanceMilliseconds of [0, -1, 1.5])
    expect(
      (
        await fetch(url, {
          method: "PUT",
          headers,
          body: JSON.stringify({ allowanceMilliseconds }),
        })
      ).status,
    ).toBe(400);
  const updated = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ allowanceMilliseconds: 20 }),
  });
  expect(updated.status).toBe(200);
  await expect(updated.json()).resolves.toMatchObject({
    changed: true,
    grant: {
      duration: { availableMilliseconds: 20, reservedMilliseconds: 0, spentMilliseconds: 0 },
    },
  });
  const inspected = await fetch(`${origin}/api/operator/grants/${created.grantId}`, { headers });
  await expect(inspected.json()).resolves.toMatchObject({
    authoritative: { duration: { availableMilliseconds: 20 } },
    registrySnapshotDisagreement: false,
  });
  const missing = await fetch(`${origin}/api/operator/grants/${crypto.randomUUID()}/allowance`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ allowanceMilliseconds: 20 }),
  });
  expect(missing.status).toBe(404);
});

test("exchanges persistent cookies and authorizes native requests without a browser origin", async () => {
  const grant = await createTrial();
  const response = await fetch(`${origin}/api/grants/${grant.grantId}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
    },
    body: JSON.stringify({ credential: grant.credential }),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const cookie = response.headers.get("Set-Cookie");
  expect(cookie).toContain("Max-Age=");
  const headers = { Cookie: cookie!.split(";")[0]! };
  const snapshot = await fetch(`${origin}/api/grants/${grant.grantId}`, { headers });
  expect(snapshot.status).toBe(200);
  expect(snapshot.headers.get("Set-Cookie")).toContain("HttpOnly");
  const history = await fetch(`${origin}/api/grants/${grant.grantId}/conversions`, { headers });
  expect(history.status).toBe(200);
  expect(history.headers.get("Set-Cookie")).toContain("HttpOnly");

  const start = await fetch(`${origin}/api/grants/${grant.grantId}/conversions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ sourceUrl: "https://source.example.test/fixture" }),
  });
  expect(start.status).toBe(202);
  const started: unknown = await start.json();
  if (typeof started !== "object" || started === null || !("conversion" in started)) {
    throw new Error("Missing conversion");
  }
  const conversion = started.conversion;
  if (
    typeof conversion !== "object" ||
    conversion === null ||
    !("conversionId" in conversion) ||
    typeof conversion.conversionId !== "string"
  ) {
    throw new Error("Missing conversion ID");
  }
  const detail = await fetch(`${origin}/api/conversions/${conversion.conversionId}`, { headers });
  expect(detail.status).toBe(200);
  expect(detail.headers.get("Set-Cookie")).toContain("HttpOnly");
  const otherGrant = await createTrial();
  expect((await fetch(`${origin}/api/grants/${otherGrant.grantId}`, { headers })).status).toBe(401);

  const revocation = await fetch(`${origin}/api/operator/grants/${grant.grantId}/revocation`, {
    method: "POST",
    headers: { "Cf-Access-Token": "local-access-token", "Content-Type": "application/json" },
    body: "{}",
  });
  expect(revocation.status).toBe(200);
  expect((await fetch(`${origin}/api/grants/${grant.grantId}`, { headers })).status).toBe(200);
  const revokedStart = await fetch(`${origin}/api/grants/${grant.grantId}/conversions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ sourceUrl: "https://source.example.test/fixture" }),
  });
  expect(revokedStart.status).toBe(403);
});

async function createTrial(): Promise<{ grantId: string; credential: string }> {
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

test("rejects native-style mutations without the request marker or with a foreign origin", async () => {
  const grant = await createTrial();
  for (const headers of [
    { "Content-Type": "application/json" },
    {
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
      Origin: "https://evil.example",
    },
    {
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
      "Sec-Fetch-Site": "cross-site",
    },
  ]) {
    const response = await fetch(`${origin}/api/grants/${grant.grantId}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ credential: grant.credential }),
    });
    expect(response.status).toBe("X-Create-Audiobook-From-URL-Request" in headers ? 403 : 400);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  }
});
