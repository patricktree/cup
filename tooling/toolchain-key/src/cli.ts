#!/usr/bin/env node
import { Command, CommanderError } from "@commander-js/extra-typings";

import { assertReadableKeyFile, writeKeyFile } from "#src/key-file.ts";
import { readPlaywrightToolchainKey } from "#src/playwright.ts";

export async function runCli(args: string[]): Promise<number> {
  const program = new Command()
    .name("toolchain-key")
    .description(
      "Write the versions of the host toolchain an E2E suite runs on, for a Turbo task to hash, and check that each was read",
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

  program
    .command("check")
    .description(
      "Fail unless every version in a key file was read; a cached suite task runs this first",
    )
    .argument("<file>", "key file to check")
    .requiredOption("--suite <name>", "suite the key file belongs to, named in the failure")
    .action(async (file, { suite }) => {
      await assertReadableKeyFile(file, suite);
    });

  try {
    await program.parseAsync(args, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    console.error(
      error instanceof Error
        ? error.message
        : `toolchain-key failed with a thrown non-error value: ${String(error)}`,
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
