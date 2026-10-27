import { Command, CommanderError } from "@commander-js/extra-typings";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { $ } from "zx";

/** The local-only account that replaces Google sign-in during development; see ADR 0012. */
const TEST_ACCOUNT_EMAIL = "test@cup.test";
/** Fixed and short so it is easy to type on a phone; Supabase requires at least six characters. */
const TEST_ACCOUNT_PASSWORD = "testtest";
/** The web app's Vite port and the local Supabase API port from `supabase/config.toml`. */
const WEB_APP_PORT = 5173;
const SUPABASE_PORT = 55321;
/** The Homebrew CLI can lag behind the macOS app's daemon, so prefer the CLI the app ships. */
const MACOS_TAILSCALE_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

const program = new Command()
  .name("dev:services")
  .description("Manage the local services used for development")
  .showHelpAfterError()
  .exitOverride();

program
  .command("start", { isDefault: true })
  .description("Start local services and configure the Worker environment")
  .option(
    "--tailnet",
    "serve the web app and Supabase on this machine's tailnet hostname, for testing on a phone",
  )
  .action(async ({ tailnet }) => run({ action: "start", tailnet: tailnet === true }));

program
  .command("stop")
  .description("Stop local services, Tailscale serving, and restore the Worker environment")
  .action(async () => run({ action: "stop" }));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
  } else {
    console.error(error instanceof Error ? error.message : "Local development services failed.");
    process.exitCode = 1;
  }
}

async function run(command: { action: "start"; tailnet: boolean } | { action: "stop" }) {
  const root = path.resolve(import.meta.dirname, "../../..");
  const workerEnvPath = path.join(root, "apps/cloudflare-worker/.env.local");
  const workerEnv = parseEnv(await fs.readFile(workerEnvPath, "utf8"));

  let terraformEnv: Record<string, string | undefined> = {};

  try {
    terraformEnv = parseEnv(await fs.readFile(path.join(root, "terraform/.env.local"), "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  // Google sign-in is optional locally: without a client, only the test account signs in.
  const clientId =
    process.env["SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID"] ??
    terraformEnv["TF_VAR_google_web_client_id"] ??
    "";
  const clientSecret =
    process.env["SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET"] ??
    terraformEnv["TF_VAR_google_web_client_secret"] ??
    "";
  const isGoogleConfigured = clientId !== "" && clientSecret !== "";

  /** Every Supabase CLI command parses `supabase/config.toml`, which reads these variables. */
  function supabaseEnvironment(origins: { webApp: string; supabase: string }) {
    return {
      ...process.env,
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: clientId,
      SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: clientSecret,
      CUP_LOCAL_GOOGLE_ENABLED: String(isGoogleConfigured),
      CUP_LOCAL_SITE_URL: `${origins.webApp}/app/`,
      CUP_LOCAL_REDIRECT_URL: `${origins.webApp}/app/**`,
      CUP_LOCAL_JWT_ISSUER: `${origins.supabase}/auth/v1`,
      CUP_LOCAL_GOOGLE_REDIRECT_URI: `${origins.supabase}/auth/v1/callback`,
    };
  }

  const localOrigins = {
    webApp: `http://localhost:${WEB_APP_PORT}`,
    supabase: `http://127.0.0.1:${SUPABASE_PORT}`,
  };

  async function supabase(
    args: string[],
    environment: ReturnType<typeof supabaseEnvironment>,
    capture = false,
  ) {
    const output = await $({
      cwd: root,
      env: environment,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      verbose: false,
    })`pnpm dlx supabase@2.118.0 ${args}`;

    return output.stdout;
  }

  const backupPath = path.join(root, "supabase/.local/worker.env.local");
  /** Present while `start --tailnet` serves the ports, so `stop` turns off only what it started. */
  const tailnetStatePath = path.join(root, "supabase/.local/tailnet-host");

  if (command.action === "stop") {
    await supabase(["stop"], supabaseEnvironment(localOrigins), true);

    if (existsSync(tailnetStatePath)) {
      for (const port of [WEB_APP_PORT, SUPABASE_PORT]) {
        await tailscale(["serve", `--https=${port}`, "off"]);
      }
      await fs.unlink(tailnetStatePath);
    }

    try {
      const backup = await fs.readFile(backupPath);
      await fs.writeFile(workerEnvPath, backup, { mode: 0o600 });
      await fs.unlink(backupPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  } else {
    await start(command.tailnet);
  }

  async function start(tailnet: boolean) {
    const tailnetHost = tailnet ? await findTailnetHost() : undefined;
    const origins = tailnetHost
      ? {
          webApp: `https://${tailnetHost}:${WEB_APP_PORT}`,
          supabase: `https://${tailnetHost}:${SUPABASE_PORT}`,
        }
      : localOrigins;
    const signingPath = path.join(root, "supabase/signing_keys.json");

    try {
      await fs.access(signingPath);
    } catch {
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const signingKey = {
        ...privateKey.export({ format: "jwk" }),
        kid: randomUUID(),
        alg: "ES256",
        use: "sig",
        key_ops: ["sign", "verify"],
      };

      await fs.writeFile(signingPath, JSON.stringify([signingKey]), { mode: 0o600 });
    }

    const environment = supabaseEnvironment(origins);
    await supabase(["start"], environment, true);

    const status = parseStatus(
      JSON.parse(await supabase(["status", "-o", "json"], environment, true)),
    );

    // `supabase start` leaves a running stack as it is, including the URLs it was started with.
    const issuer = await readIssuer(status.API_URL);
    if (issuer !== environment.CUP_LOCAL_JWT_ISSUER) {
      throw new Error(
        `Local Supabase is running with the issuer ${issuer}. Run \`pnpm dev:services stop\` first.`,
      );
    }

    await ensureTestAccount(status.API_URL, status.SERVICE_ROLE_KEY, TEST_ACCOUNT_PASSWORD);

    if (tailnetHost) {
      for (const port of [WEB_APP_PORT, SUPABASE_PORT]) {
        await tailscale(["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${port}`]);
      }
      await fs.mkdir(path.dirname(tailnetStatePath), { recursive: true });
      await fs.writeFile(tailnetStatePath, `${tailnetHost}\n`);
    }

    const values = {
      ...workerEnv,
      // Tokens carry the issuer Supabase was started with; the Worker verifies against this URL.
      SUPABASE_URL: tailnetHost ? origins.supabase : status.API_URL,
      SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      SUPABASE_SECRET_KEY: status.SERVICE_ROLE_KEY,
      GOOGLE_WEB_CLIENT_ID: isGoogleConfigured ? clientId : "",
      // Kept across restarts so that signed media URLs issued earlier stay valid.
      MEDIA_URL_SIGNING_KEY:
        workerEnv["MEDIA_URL_SIGNING_KEY"] ?? randomBytes(32).toString("base64url"),
      LOCAL_DEVELOPMENT: "true",
      LOCAL_TEST_ACCOUNT_EMAIL: TEST_ACCOUNT_EMAIL,
      LOCAL_TEST_ACCOUNT_PASSWORD: TEST_ACCOUNT_PASSWORD,
    };
    await fs.mkdir(path.dirname(backupPath), { recursive: true });

    try {
      await fs.writeFile(backupPath, await fs.readFile(workerEnvPath), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }

    await fs.writeFile(
      workerEnvPath,
      Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );

    console.log(
      [
        "Local development services started. Restart the Cup development server.",
        `Open ${origins.webApp}/app/ and choose "Sign in with test account".`,
        ...(isGoogleConfigured ? [] : ["Google sign-in is off: no Google OAuth client is set."]),
      ].join("\n"),
    );
  }
}

function parseStatus(status: unknown) {
  if (
    !status ||
    typeof status !== "object" ||
    !("API_URL" in status) ||
    !("ANON_KEY" in status) ||
    !("SERVICE_ROLE_KEY" in status) ||
    typeof status.API_URL !== "string" ||
    typeof status.ANON_KEY !== "string" ||
    typeof status.SERVICE_ROLE_KEY !== "string"
  ) {
    throw new Error("Local Supabase status is incomplete.");
  }
  return {
    API_URL: status.API_URL,
    ANON_KEY: status.ANON_KEY,
    SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  };
}

function tailscaleCli() {
  return (
    process.env["TAILSCALE_CLI"] ??
    (process.platform === "darwin" && existsSync(MACOS_TAILSCALE_CLI)
      ? MACOS_TAILSCALE_CLI
      : "tailscale")
  );
}

async function tailscale(args: string[]) {
  const output = await $({
    stdio: ["ignore", "pipe", "inherit"],
    verbose: false,
  })`${tailscaleCli()} ${args}`;
  return output.stdout;
}

async function findTailnetHost() {
  const status: unknown = JSON.parse(await tailscale(["status", "--json"]));
  const dnsName =
    status &&
    typeof status === "object" &&
    "Self" in status &&
    status.Self &&
    typeof status.Self === "object" &&
    "DNSName" in status.Self &&
    typeof status.Self.DNSName === "string"
      ? status.Self.DNSName.replace(/\.$/, "")
      : "";
  if (!dnsName) {
    throw new Error("Tailscale reports no DNS name for this machine. Is it connected?");
  }
  return dnsName;
}

async function readIssuer(apiUrl: string) {
  const response = await fetch(`${apiUrl}/auth/v1/.well-known/openid-configuration`);
  const configuration: unknown = await response.json();
  return configuration &&
    typeof configuration === "object" &&
    "issuer" in configuration &&
    typeof configuration.issuer === "string"
    ? configuration.issuer
    : undefined;
}

/** Creates the test account, or resets its password when it already exists with another one. */
async function ensureTestAccount(apiUrl: string, secretKey: string, password: string) {
  const headers = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };
  const created = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: TEST_ACCOUNT_EMAIL, password, email_confirm: true }),
  });
  if (created.ok) {
    return;
  }
  const failure: unknown = await created.json();
  if (!(failure && typeof failure === "object" && "error_code" in failure)) {
    throw new Error(`Creating the local test account failed with status ${created.status}.`);
  }
  if (failure.error_code !== "email_exists") {
    throw new Error(`Creating the local test account failed: ${String(failure.error_code)}.`);
  }
  const listed = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=1000`, { headers });
  const listing: unknown = await listed.json();
  const users =
    listing && typeof listing === "object" && "users" in listing && Array.isArray(listing.users)
      ? (listing.users as unknown[])
      : [];
  const user = users.find(
    (candidate): candidate is { id: string } =>
      !!candidate &&
      typeof candidate === "object" &&
      "email" in candidate &&
      candidate.email === TEST_ACCOUNT_EMAIL &&
      "id" in candidate &&
      typeof candidate.id === "string",
  );
  if (!user) {
    throw new Error("The local test account exists but could not be found.");
  }
  const updated = await fetch(`${apiUrl}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ password }),
  });
  if (!updated.ok) {
    throw new Error(`Resetting the local test account failed with status ${updated.status}.`);
  }
}
