import type { Gate } from "#src/gates.ts";
import { findTrackedChanges, runGit } from "#src/git.ts";
import { runCommand } from "#src/run-command.ts";

type Step = Gate["steps"][number];

type StepOutcome =
  | { status: "passed" | "failed"; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "not run" };

type StepResult = { step: Step; outcome: StepOutcome };

/**
 * Checks the gate's prerequisites, then runs its steps in order and stops at the first failure.
 * Step output goes to the terminal; the returned summary is Markdown meant to be posted verbatim.
 * Every failure, including an error from the runner's own git or turbo calls, ends up named in the
 * summary rather than thrown.
 */
export async function runGate(gate: Gate): Promise<{ isPassed: boolean; summary: string }> {
  const startedAt = performance.now();
  const results: StepResult[] = gate.steps.map((step) => ({
    step,
    outcome: { status: "not run" },
  }));

  let commit: string;
  try {
    commit = await describeCommit();
  } catch (error) {
    commit = "unknown";
    const failure = `Stopped before the prerequisites because the commit could not be determined:\n\n${formatError(error)}`;
    return finish({ gate, commit, results, startedAt, failure });
  }

  log("Checking prerequisites.");
  const problems = await Promise.all(
    gate.prerequisites.map((prerequisite) =>
      prerequisite
        .findProblem()
        .catch(
          (error: unknown) => `Checking "${prerequisite.name}" failed:\n\n${formatError(error)}`,
        ),
    ),
  );
  const problemList = problems
    .filter((problem) => problem !== undefined)
    // Indents continuation lines so that a multi-line problem stays one list item.
    .map((problem) => `- ${problem.replaceAll(/\n(?=.)/g, "\n  ")}`)
    .join("\n");
  if (problemList !== "") {
    log(`Prerequisites are not met; no step ran:\n${problemList}`);
    const failure = `Stopped before the first step because prerequisites are not met:\n\n${problemList}`;
    return finish({ gate, commit, results, startedAt, failure });
  }

  for (const result of results) {
    const failure = await runStep(result);
    if (failure !== undefined) {
      log(`${failure} Stopping the ${gate.name} gate.`);
      return finish({ gate, commit, results, startedAt, failure });
    }
  }
  return finish({ gate, commit, results, startedAt, failure: undefined });
}

/** Runs one step and records its outcome; returns why the gate stops, or undefined to go on. */
async function runStep(result: StepResult): Promise<string | undefined> {
  const { step } = result;

  let skipReason: string | undefined;
  try {
    skipReason = await step.findSkipReason?.();
  } catch (error) {
    result.outcome = { status: "failed", durationMs: 0 };
    return `Stopped at step "${step.name}", whose check for skipping it failed:\n\n${formatError(error)}`;
  }
  if (skipReason !== undefined) {
    log(`Skipping ${step.name}: ${skipReason}.`);
    result.outcome = { status: "skipped", reason: skipReason };
    return undefined;
  }

  log(`${step.name}: ${step.command.join(" ")}`);
  const stepStartedAt = performance.now();
  const { exitCode } = await runCommand(step.command, { isOutputCaptured: false });
  const durationMs = performance.now() - stepStartedAt;

  if (exitCode !== 0) {
    result.outcome = { status: "failed", durationMs };
    return `Stopped at step "${step.name}", which failed with exit code ${exitCode}.`;
  }
  result.outcome = { status: "passed", durationMs };
  return undefined;
}

function finish({
  gate,
  commit,
  results,
  startedAt,
  failure,
}: {
  gate: Gate;
  commit: string;
  results: StepResult[];
  startedAt: number;
  /** A Markdown paragraph or list saying why the gate stopped. */
  failure: string | undefined;
}): { isPassed: boolean; summary: string } {
  const rows = results.map(({ step, outcome }) => {
    if (outcome.status === "passed" || outcome.status === "failed") {
      return `| ${step.name} | ${outcome.status} | ${formatDuration(outcome.durationMs)} |`;
    }
    if (outcome.status === "skipped") {
      return `| ${step.name} | skipped: ${outcome.reason} | - |`;
    }
    return `| ${step.name} | not run | - |`;
  });

  const summary = [
    `## ${capitalize(gate.name)} gate: ${failure === undefined ? "passed" : "failed"}`,
    "",
    `Commit ${commit}, ${formatDuration(performance.now() - startedAt)} in total.`,
    "",
    ...(failure === undefined ? [] : [failure, ""]),
    "| Step | Result | Duration |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
  return { isPassed: failure === undefined, summary };
}

/** The short SHA, marked when tracked files differ from it, since the gate then ran on other code. */
async function describeCommit(): Promise<string> {
  const sha = `\`${(await runGit(["rev-parse", "--short", "HEAD"])).trim()}\``;
  return (await findTrackedChanges()) === "" ? sha : `${sha} with uncommitted changes`;
}

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `\`\`\`\n${message.trim()}\n\`\`\``;
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
