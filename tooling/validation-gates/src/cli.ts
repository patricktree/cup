import { Argument, Command } from "@commander-js/extra-typings";
import process from "node:process";

import { GATE_NAMES, GATES } from "#src/gates.ts";
import { runGate } from "#src/run-gate.ts";

const program = new Command()
  .name("validation-gates")
  .description("Run a validation gate and print a Markdown summary to post as evidence")
  .showHelpAfterError()
  .addArgument(new Argument("<gate>", "the gate to run").choices(GATE_NAMES))
  .action(async (gateName) => {
    const { isPassed, summary } = await runGate(GATES[gateName]);
    console.log(`\n${summary}`);
    process.exitCode = isPassed ? 0 : 1;
  });

await program.parseAsync();
