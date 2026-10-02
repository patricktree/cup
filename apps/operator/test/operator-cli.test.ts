import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { LOCAL_OPERATOR_ACCESS_TOKEN } from "@cup/operator-api.routes";

const GRANT_ID = "b4ad28a8-bbd7-46af-a17c-59527becd745";
const REQUEST_ID = "2f94d6a9-68eb-49eb-b88e-753cf5fba041";
const CREATED_AT = "2026-08-28T10:00:00Z";
const EXPIRES_AT = "2026-11-26T10:00:00Z";
const root = path.resolve(import.meta.dirname, "../../..");
const cliPath = path.join(root, "apps/operator/src/cli.ts");
let server: http.Server;
let operatorUrl: string;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    void handleRequest(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test server address.");
  operatorUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(
  async () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

describe("actual operator CLI process", () => {
  test("shows command help", async () => {
    const result = await runCli("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Manage conversion grants");
  });

  test("rejects HTTP for a Tailnet operator URL", async () => {
    const result = await runCliAt(
      "http://macbook-pro-pkerschbaum.oberhasli-universe.ts.net:5173",
      "grant",
      "list",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("The operator URL must use HTTPS.");
  });

  test.each([
    ["create", ["grant", "create", "--label", "Evaluation", "--request-id", REQUEST_ID]],
    ["list", ["grant", "list"]],
    ["inspect", ["grant", "inspect", GRANT_ID]],
    ["revoke", ["grant", "revoke", GRANT_ID, "--yes"]],
    ["invalidate", ["grant", "invalidate-sessions", GRANT_ID, "--reason", "Emergency", "--yes"]],
  ])("runs %s in JSON mode without leaking authorization", async (_name, arguments_) => {
    const result = await runCli("--json", ...arguments_);
    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
    expect(`${result.stdout}${result.stderr}`).not.toContain("local-access-token");
    expect(`${result.stdout}${result.stderr}`).not.toContain("Cf-Access-Token");
  });

  test("lists account deletions through the authenticated operator API", async () => {
    const result = await runCli("--json", "account", "deletions");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout) as unknown).toEqual({ attempts: [], receipts: [] });
  });

  test("reports account inspection errors through the shared RPC error handling", async () => {
    const result = await runCli("--json", "account", "inspect", GRANT_ID);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr) as unknown).toEqual({
      error: { code: "operator-error", message: "The operator request failed." },
    });
  });

  test("labels projected and authoritative human output", async () => {
    expect((await runCli("grant", "list")).stdout).toContain("State (projected)");
    expect((await runCli("grant", "inspect", GRANT_ID)).stdout).toContain("State (authoritative)");
  });

  test("prints a complete partial migration report and exits one", async () => {
    const result = await runCli("--json", "grant", "migrate", "--yes");
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout) as unknown).toEqual({
      complete: false,
      registryVersion: 1,
      grants: [{ grantId: GRANT_ID, success: false, error: "Migration failed." }],
    });
  });
});

function runCli(
  ...arguments_: string[]
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return runCliAt(operatorUrl, ...arguments_);
}

function runCliAt(
  targetOperatorUrl: string,
  ...arguments_: string[]
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cliPath, "--operator-url", targetOperatorUrl, ...arguments_],
      {
        cwd: root,
        env: { ...process.env, CREATE_AUDIOBOOK_FROM_URL_ACCESS_TOKEN: undefined },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
  const url = new URL(request.url ?? "/", operatorUrl);
  if (request.headers["cf-access-token"] !== LOCAL_OPERATOR_ACCESS_TOKEN)
    return send(response, 401, {
      error: { code: "operator-unauthorized", message: "Local authorization required." },
    });
  if (request.method === "GET") {
    if (url.pathname === "/api/operator/accounts/deletions")
      return send(response, 200, { attempts: [], receipts: [] });
    if (url.pathname === `/api/operator/accounts/${GRANT_ID}`)
      return send(response, 404, {
        error: {
          code: "account-unavailable",
          message: "Account unavailable.",
          requestId: REQUEST_ID,
        },
      });
  }
  const body = await readBody(request);
  if (body !== "" && request.headers["content-type"] !== "application/json")
    return send(response, 415, {
      error: { code: "unsupported-media-type", message: "JSON required." },
    });
  if (request.method === "POST" && url.pathname === "/api/operator/grants")
    return send(response, 201, {
      result: "issued",
      grantId: GRANT_ID,
      requestId: REQUEST_ID,
      label: "Evaluation",
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      state: "open",
      trialLink: `${operatorUrl}/app/trials/${GRANT_ID}#credential=v1.${"a".repeat(43)}`,
    });
  if (request.method === "GET" && url.pathname === "/api/operator/grants")
    return send(response, 200, {
      grants: [
        {
          grantId: GRANT_ID,
          requestId: REQUEST_ID,
          label: "Evaluation",
          createdAt: CREATED_AT,
          expiresAt: EXPIRES_AT,
          state: "open",
        },
      ],
    });
  if (request.method === "GET" && url.pathname === `/api/operator/grants/${GRANT_ID}`)
    return send(response, 200, inspectFixture());
  if (request.method === "POST" && url.pathname.endsWith("/revocation"))
    return send(response, 200, { changed: true, grant: grantFixture("revoked") });
  if (request.method === "POST" && url.pathname.endsWith("/session-invalidations"))
    return send(response, 200, { invalidatedAt: CREATED_AT, grant: grantFixture("revoked") });
  if (request.method === "POST" && url.pathname === "/api/operator/grant-migrations")
    return send(response, 200, {
      complete: false,
      registryVersion: 1,
      grants: [{ grantId: GRANT_ID, success: false, error: "Migration failed." }],
    });
  return send(response, 404, { error: { code: "not-found", message: "Not found." } });
}

function grantFixture(state: "open" | "revoked") {
  return {
    grantId: GRANT_ID,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    ...(state === "revoked" ? { revokedAt: CREATED_AT } : {}),
    state,
    duration: { availableMilliseconds: 5, reservedMilliseconds: 0, spentMilliseconds: 0 },
    conversions: [],
  };
}

function inspectFixture() {
  return {
    registry: {
      grantId: GRANT_ID,
      requestId: REQUEST_ID,
      label: "Evaluation",
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      state: "open",
    },
    authoritative: {
      ...grantFixture("open"),
      allowanceMilliseconds: 7_200_000,
      signingKeyGeneration: 1,
      registrySnapshotRevision: 1,
      registryConfirmedSnapshotRevision: 1,
    },
    registrySnapshotDisagreement: false,
  };
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}
