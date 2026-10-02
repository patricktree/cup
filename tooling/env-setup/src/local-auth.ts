import { Command, CommanderError } from "@commander-js/extra-typings";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { $ } from "zx";

const program = new Command()
  .name("auth:local")
  .description("Manage local Supabase authentication")
  .showHelpAfterError()
  .exitOverride();

program
  .command("start", { isDefault: true })
  .description("Start local Supabase and configure the Worker environment")
  .action(async () => run("start"));

program
  .command("stop")
  .description("Stop local Supabase and restore the Worker environment")
  .action(async () => run("stop"));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) process.exitCode = error.exitCode;
  else {
    console.error(error instanceof Error ? error.message : "Local auth configuration failed.");
    process.exitCode = 1;
  }
}

async function run(action: "start" | "stop") {
  const root = path.resolve(import.meta.dirname, "../../..");
  const workerEnvPath = path.join(root, "apps/cloudflare-worker/.env.local");
  const workerEnv = parseEnv(await fs.readFile(workerEnvPath, "utf8"));

  let terraformEnv: Record<string, string | undefined> = {};

  try {
    terraformEnv = parseEnv(await fs.readFile(path.join(root, "terraform/.env.local"), "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const clientId =
    process.env["SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID"] ??
    terraformEnv["TF_VAR_google_web_client_id"];
  const clientSecret =
    process.env["SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET"] ??
    terraformEnv["TF_VAR_google_web_client_secret"];

  if (action === "start" && (!clientId || !clientSecret))
    throw new Error("Configure the local Google OAuth client ID and secret.");

  const environment = {
    ...process.env,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: clientId,
    SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: clientSecret,
  };

  async function supabase(args: string[], capture = false) {
    const output = await $({
      cwd: root,
      env: environment,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      verbose: false,
    })`pnpm dlx supabase@2.118.0 ${args}`;

    return output.stdout;
  }

  const backupPath = path.join(root, "supabase/.local/worker.env.local");

  if (action === "stop") {
    await supabase(["stop"], true);

    try {
      const backup = await fs.readFile(backupPath);
      await fs.writeFile(workerEnvPath, backup, { mode: 0o600 });
      await fs.unlink(backupPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  } else {
    await start();
  }

  async function start() {
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

    await supabase(["start"], true);

    const status: unknown = JSON.parse(await supabase(["status", "-o", "json"], true));

    if (
      !status ||
      typeof status !== "object" ||
      !("API_URL" in status) ||
      !("ANON_KEY" in status) ||
      !("SERVICE_ROLE_KEY" in status) ||
      typeof status.API_URL !== "string" ||
      typeof status.ANON_KEY !== "string" ||
      typeof status.SERVICE_ROLE_KEY !== "string"
    )
      throw new Error("Local Supabase status is incomplete.");

    const values = {
      ...workerEnv,
      SUPABASE_URL: status.API_URL,
      SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      SUPABASE_SECRET_KEY: status.SERVICE_ROLE_KEY,
      GOOGLE_WEB_CLIENT_ID: clientId,
      LOCAL_DEVELOPMENT: "true",
    };
    await fs.mkdir(path.dirname(backupPath), { recursive: true });

    try {
      await fs.writeFile(backupPath, await fs.readFile(workerEnvPath), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }

    await fs.writeFile(
      workerEnvPath,
      Object.entries(values)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );

    console.log("Local auth configured. Restart the Cup development server.");
  }
}
