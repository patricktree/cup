import { Command, CommanderError } from "@commander-js/extra-typings";
import fs from "node:fs/promises";
import path from "node:path";
import util from "node:util";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const FILES = ["apps/cloudflare-worker/.env.local", "libs/narration-content-selection/.env.evals"];
const KEYS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"] as const;
const HELP =
  "Run node tooling/env-setup/src/cli.ts setup --from /absolute/path/to/existing.env, or export both credentials and run node tooling/env-setup/src/cli.ts setup. Then retry pnpm install.";

export async function runCli(
  args: string[],
  root = ROOT,
  environment: Record<string, string | undefined> = process.env,
  output = console,
): Promise<number> {
  const program = new Command()
    .name("env-setup")
    .description("Set up and validate matching workspace environment files")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (message) => output.log(message),
      writeErr: (message) => output.error(message),
    });

  program
    .command("setup")
    .description("Create missing environment files from a file or exported credentials")
    .option("--from <env-file>", "read credentials from an existing environment file")
    .action(async (options) => run("setup", options.from));

  program
    .command("check")
    .description("Check that both environment files are configured and match")
    .action(async () => run("check"));

  try {
    await program.parseAsync(args, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    output.error(error instanceof Error ? error.message : "Environment configuration failed.");
    return 1;
  }

  async function run(command: "setup" | "check", from?: string) {
    const files = await Promise.all(
      FILES.map(async (file) => ({ file, values: await readEnv(path.join(root, file)) })),
    );
    const problems: string[] = [];
    let source: Record<string, string | undefined> | null | undefined;
    if (command === "setup") {
      source = from !== undefined ? await readEnv(path.resolve(from)) : environment;
      problems.push(...validate(source, "Credential source"));
    }
    for (const { file, values } of files) {
      if (command === "setup" && values === null) {
        continue;
      }
      problems.push(...validate(values, file));
    }
    const reference = source ?? files[0]!.values;
    for (const { file, values } of files) {
      if (!values || !reference) {
        continue;
      }
      for (const key of KEYS) {
        if (values[key] && reference[key] && values[key] !== reference[key]) {
          problems.push(
            `${file}: ${key} differs from ${source ? "the credential source" : FILES[0]}. Existing files are preserved.`,
          );
        }
      }
    }
    if (problems.length) {
      throw new Error(`${problems.join("\n")}\n${HELP}`);
    }
    if (command === "setup" && source) {
      const credentials = source;
      const content = KEYS.map((key) => `${key}='${credentials[key]}'`).join("\n") + "\n";
      for (const { file, values } of files) {
        if (values !== null) {
          continue;
        }
        await fs.writeFile(path.join(root, file), content, { flag: "wx", mode: 0o600 });
        output.log(`Created ${file}`);
      }
    }
    output.log("Environment files are configured and match.");
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}

async function readEnv(file: string) {
  try {
    return util.parseEnv(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw new Error(`Cannot read environment file: ${file}`, { cause: error });
  }
}

function validate(values: Record<string, string | undefined> | null, label: string) {
  if (values === null) {
    return [`${label}: file is missing.`];
  }
  return KEYS.flatMap((key) => {
    const value = values[key];
    if (!value?.trim()) {
      return [`${label}: ${key} is missing or empty.`];
    }
    if (/^(?:your[-_ ]|replace[-_ ]|changeme$|placeholder$|example$|<)/i.test(value)) {
      return [`${label}: ${key} is a placeholder.`];
    }
    if (/[\s'"`]/u.test(value)) {
      return [`${label}: ${key} contains whitespace or quotes.`];
    }
    return [];
  });
}
