import { Command, CommanderError } from "@commander-js/extra-typings";
import path from "node:path";

import { checkCommits, checkStaged } from "#src/submodule-pointer.ts";
import type { CheckResult, Environment } from "#src/submodule-pointer.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

export async function runCli(
  args: string[],
  root = ROOT,
  environment: Environment = process.env,
  output = console,
): Promise<number> {
  let result: CheckResult = { problems: [], notes: [] };
  const program = new Command()
    .name("submodule-check")
    .description("Reject changes that move a submodule pointer backwards")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (message) => output.log(message),
      writeErr: (message) => output.error(message),
    });

  program
    .command("staged")
    .description("Check staged submodule pointers against HEAD and origin/main")
    .action(async () => {
      result = await checkStaged(root, environment);
    });

  program
    .command("commits")
    .description("Check the commits that are reachable from the revisions but not on any remote")
    .argument("<revisions...>", "revisions to check, e.g. the local commits of a push")
    .action(async (revisions) => {
      result = await checkCommits(root, environment, revisions);
    });

  try {
    await program.parseAsync(args, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    output.error(error instanceof Error ? error.message : "Submodule check failed.");
    return 1;
  }

  for (const note of result.notes) {
    output.log(note);
  }
  if (result.problems.length > 0) {
    output.error(result.problems.join("\n\n"));
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
