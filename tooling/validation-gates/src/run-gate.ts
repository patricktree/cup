import type { Gate } from "#src/gates.ts";
import { runCommand } from "#src/run-command.ts";

type StepOutcome =
  | { status: "passed" | "failed"; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "not run" };

/**
 * Checks the gate's prerequisites, then runs its steps in order and stops at the first failure.
 * Step output goes to the terminal; the returned summary is Markdown meant to be posted verbatim.
 */
export async function runGate(gate: Gate): Promise<{ isPassed: boolean; summary: string }> {
  const startedAt = performance.now();
  const commit = await describeCommit();
  const outcomes: StepOutcome[] = gate.steps.map(() => ({ status: "not run" }));

  log("Checking prerequisites.");
  const problems = await Promise.all(
    gate.prerequisites.map((prerequisite) => prerequisite.findProblem()),
  );
  const problemList = problems
    .filter((problem) => problem !== undefined)
    /* Indents continuation lines so that a multi-line problem stays one list item. */
    .map((problem) => `- ${problem.replaceAll(/\n(?=.)/g, "\n  ")}`)
    .join("\n");
  if (problemList !== "") {
    log(`Prerequisites are not met; no step ran:\n${problemList}`);
    return {
      isPassed: false,
      summary: formatSummary({
        gate,
        commit,
        outcomes,
        totalMs: performance.now() - startedAt,
        failure: `Stopped before the first step because prerequisites are not met:\n\n${problemList}`,
      }),
    };
  }

  let failure: string | undefined;
  for (const [index, step] of gate.steps.entries()) {
    const skipReason = await step.findSkipReason?.();
    if (skipReason !== undefined) {
      log(`Skipping ${step.name}: ${skipReason}.`);
      outcomes[index] = { status: "skipped", reason: skipReason };
      continue;
    }

    log(`${step.name}: ${step.command.join(" ")}`);
    const stepStartedAt = performance.now();
    const { exitCode } = await runCommand(step.command, { isOutputCaptured: false });
    const durationMs = performance.now() - stepStartedAt;

    if (exitCode !== 0) {
      outcomes[index] = { status: "failed", durationMs };
      failure = `Stopped at step "${step.name}", which failed with exit code ${exitCode}.`;
      log(`${step.name} failed with exit code ${exitCode}; stopping the ${gate.name} gate.`);
      break;
    }
    outcomes[index] = { status: "passed", durationMs };
  }

  return {
    isPassed: failure === undefined,
    summary: formatSummary({
      gate,
      commit,
      outcomes,
      totalMs: performance.now() - startedAt,
      failure,
    }),
  };
}

function formatSummary({
  gate,
  commit,
  outcomes,
  totalMs,
  failure,
}: {
  gate: Gate;
  commit: string;
  outcomes: StepOutcome[];
  totalMs: number;
  /** A Markdown paragraph or list saying why the gate stopped. */
  failure: string | undefined;
}): string {
  const rows = gate.steps.map((step, index) => {
    const outcome = outcomes[index]!;
    if (outcome.status === "passed" || outcome.status === "failed") {
      return `| ${step.name} | ${outcome.status} | ${formatDuration(outcome.durationMs)} |`;
    }
    if (outcome.status === "skipped") {
      return `| ${step.name} | skipped: ${outcome.reason} | - |`;
    }
    return `| ${step.name} | not run | - |`;
  });

  return [
    `## ${capitalize(gate.name)} gate: ${failure === undefined ? "passed" : "failed"}`,
    "",
    `Commit ${commit}, ${formatDuration(totalMs)} in total.`,
    "",
    ...(failure === undefined ? [] : [failure, ""]),
    "| Step | Result | Duration |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The short SHA, marked when tracked files differ from it, since the gate then ran on other code. */
async function describeCommit(): Promise<string> {
  const shortSha = await runCommand(["git", "rev-parse", "--short", "HEAD"]);
  if (shortSha.exitCode !== 0) {
    throw new Error(`\`git rev-parse --short HEAD\` failed:\n${shortSha.output}`);
  }

  const status = await runCommand(["git", "status", "--porcelain", "--untracked-files=no"]);
  if (status.exitCode !== 0) {
    throw new Error(`\`git status\` failed:\n${status.output}`);
  }

  const sha = `\`${shortSha.stdout.trim()}\``;
  return status.stdout.trim() === "" ? sha : `${sha} with uncommitted changes`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${(durationMs / 1000).toFixed(1)} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} min ${seconds} s`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function log(message: string): void {
  console.error(`\n[gate] ${message}`);
}
