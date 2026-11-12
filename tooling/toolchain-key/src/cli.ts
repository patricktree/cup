#!/usr/bin/env node
import { Command, CommanderError } from "@commander-js/extra-typings";
import fs from "node:fs/promises";
import path from "node:path";

import { readPlaywrightToolchainKey } from "#src/playwright.ts";

export async function runCli(args: string[]): Promise<number> {
  const program = new Command()
    .name("toolchain-key")
    .description(
      "Write the versions of the host toolchain an E2E suite runs on, for a Turbo task to hash",
    )
    .showHelpAfterError()
    .exitOverride();

  program
    .command("playwright")
    .description("Key of the Playwright Server image the browsers run in")
    .requiredOption("--output <file>", "key file to write")
    .action(async ({ output }) => {
      await writeKeyFile(output, await readPlaywrightToolchainKey());
    });

  try {
    await program.parseAsync(args, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    console.error(error instanceof Error ? error.message : "Writing the toolchain key failed.");
    return 1;
  }
}

async function writeKeyFile(file: string, key: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(key, undefined, 2)}\n`);
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
