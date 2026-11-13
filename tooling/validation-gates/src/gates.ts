import process from "node:process";
import { z } from "zod";

import { findTrackedChanges, runGit } from "#src/git.ts";
import { runCommand, runCommandOrThrow } from "#src/run-command.ts";

type Prerequisite = {
  /** Names the prerequisite in the summary when checking it fails, such as "Docker running". */
  name: string;
  /**
   * Returns what is missing or wrong, such as "Docker is not running", or undefined when the
   * prerequisite is met.
   */
  findProblem: () => Promise<string | undefined>;
};

type Step = {
  name: string;
  /** Runs from the repository root, without a shell. */
  command: [string, ...string[]];
  /**
   * Decides right before the step whether it runs; a string skips the step and gives the reason
   * shown in the summary.
   */
  findSkipReason?: () => Promise<string | undefined>;
  /**
   * The step runs cached E2E suite tasks whose replay the summary marks: when Turbo reports every
   * one of them as a cache hit, the step's result reads "passed (replayed)" (#302).
   */
  isReplayMarked?: boolean;
};

/**
 * Each gate includes every prerequisite and step of the gate before it: a later gate spreads its
 * predecessor's `prerequisites` and `steps` and appends its own instead of repeating them.
 */
export type Gate = {
  name: string;
  prerequisites: Prerequisite[];
  steps: Step[];
};

const NARRATION_SOURCE_ANALYSIS = "@cup/narration-source-analysis";
/**
 * The ref the evals rule compares against, as last fetched, so that commits on a stale local `main`
 * do not count as the branch's changes.
 */
const AFFECTED_BASE = "origin/main";
/** The part of `turbo ls --output=json` the evals rule reads. */
const TURBO_LS_OUTPUT = z.object({
  packages: z.object({ items: z.array(z.object({ name: z.string() })) }),
});

const DOCKER_RUNNING = commandPrerequisite(
  "Docker running",
  ["docker", "info"],
  "Docker is not running (`docker info` failed); start Docker Desktop.",
);
const UVX_INSTALLED = commandPrerequisite(
  "uvx installed",
  ["uvx", "--version"],
  "`uvx` is not installed (`uvx --version` failed); zizmor runs through it.",
);
const GH_AUTHENTICATED = commandPrerequisite(
  "GitHub CLI authenticated",
  ["gh", "auth", "status"],
  "GitHub CLI is not authenticated (`gh auth status` failed); zizmor needs its token. Run `gh auth login`.",
);

/**
 * The deploy gate runs on exactly the commit being deployed: a clean `main` equal to a freshly
 * fetched `origin/main`.
 */
const CHECKOUT_DEPLOYABLE: Prerequisite = {
  name: "Checkout at `origin/main`",
  findProblem: async () => {
    await runGit(["fetch", "origin"]);

    const branchName = (await runGit(["branch", "--show-current"])).trim();
    if (branchName !== "main") {
      const actual = branchName === "" ? "a detached `HEAD`" : `branch \`${branchName}\``;
      return `The checkout is on ${actual}, not \`main\`; the deploy gate runs only on \`main\`.`;
    }

    const head = (await runGit(["rev-parse", "HEAD"])).trim();
    const originMain = (await runGit(["rev-parse", "refs/remotes/origin/main"])).trim();
    if (head !== originMain) {
      return `\`HEAD\` (${head.slice(0, 8)}) differs from the freshly fetched \`origin/main\` (${originMain.slice(0, 8)}); the deploy gate runs only on exactly \`origin/main\`.`;
    }

    const changes = await findTrackedChanges();
    if (changes !== "") {
      return `Tracked files have uncommitted changes; the deploy gate runs only on a clean checkout:\n\n\`\`\`\n${changes}\n\`\`\``;
    }
    return undefined;
  },
};

/**
 * The mobile E2E suite's own preflight check for both platforms, run up front so that a missing
 * toolchain fails the deploy gate before its first step rather than after the web suites.
 */
const MOBILE_TOOLCHAINS_READY = commandPrerequisite(
  "Mobile toolchains ready",
  ["pnpm", "--silent", "--filter", "@cup/mobile-e2e", "run", "preflight"],
  "The mobile E2E suite's preflight check failed",
  { isOutputShown: true },
);

/** Runs before the operator reviews a pull request; see the validation section of AGENTS.md. */
const REVIEW_GATE: Gate = {
  name: "review",
  prerequisites: [DOCKER_RUNNING, UVX_INSTALLED, GH_AUTHENTICATED],
  steps: [
    { name: "Env check", command: ["pnpm", "run", "env:check"] },
    { name: "Submodule check", command: ["pnpm", "run", "submodule:check"] },
    { name: "Format check", command: ["pnpm", "run", "format:check"] },
    { name: "Docs check", command: ["pnpm", "run", "docs:check"] },
    { name: "Turbo boundaries", command: ["pnpm", "run", "boundaries"] },
    // Turbo cache hits are accepted, so no `--force`; lint and test reuse the build's cache.
    { name: "Build", command: turboRun("turbo:build") },
    { name: "Lint", command: turboRun("turbo:lint") },
    { name: "Test", command: turboRun("turbo:test") },
    // Knip loads the Worker's Vite config, which requires the built web app, so it runs after the build.
    { name: "Knip", command: ["pnpm", "run", "declutter"] },
    { name: "Brand-assets check", command: ["pnpm", "run", "brand-assets:check"] },
    { name: "Zizmor", command: ["pnpm", "run", "zizmor"] },
    // A cached Turbo task whose hash includes the Playwright Server image, so a pass on unchanged
    // inputs is replayed (ADR 0024).
    {
      name: "Source-material E2E",
      command: ["pnpm", "run", "test:e2e:source-material"],
      isReplayMarked: true,
    },
    {
      // Outside Turbo, so the paid evals always run fresh.
      name: "Narration evals",
      command: ["pnpm", "run", "evals"],
      findSkipReason: async () =>
        (await findAffectedPackages()).includes(NARRATION_SOURCE_ANALYSIS)
          ? undefined
          : `\`${NARRATION_SOURCE_ANALYSIS}\` and its dependencies are not affected relative to \`${AFFECTED_BASE}\``,
    },
  ],
};

/** Runs after approval on the head rebased onto a freshly fetched `origin/main`. */
const MERGE_GATE: Gate = {
  name: "merge",
  prerequisites: [...REVIEW_GATE.prerequisites],
  steps: [
    ...REVIEW_GATE.steps,
    // A cached Turbo task like source-material E2E, so a pass on unchanged inputs is replayed.
    { name: "App E2E", command: ["pnpm", "run", "test:e2e:app"], isReplayMarked: true },
  ],
};

/** Runs in the main checkout at exactly `origin/main`, right before a deploy. */
const DEPLOY_GATE: Gate = {
  name: "deploy",
  prerequisites: [CHECKOUT_DEPLOYABLE, ...MERGE_GATE.prerequisites, MOBILE_TOOLCHAINS_READY],
  steps: [
    ...MERGE_GATE.steps,
    // Turbo runs the cached Android and iOS tasks at the same time, which five consecutive warm
    // runs passed (#301); a platform whose inputs and toolchain are unchanged is replayed (ADR 0026).
    { name: "Mobile E2E", command: ["pnpm", "run", "test:e2e:mobile"], isReplayMarked: true },
  ],
};

export const GATE_NAMES = ["review", "merge", "deploy"] as const;

export type GateName = (typeof GATE_NAMES)[number];

export const GATES: Record<GateName, Gate> = {
  review: REVIEW_GATE,
  merge: MERGE_GATE,
  deploy: DEPLOY_GATE,
};

/**
 * A prerequisite met when the command exits with 0. With `isOutputShown`, the command's output
 * follows the message, for checks whose output names the fix.
 */
function commandPrerequisite(
  name: string,
  command: [string, ...string[]],
  message: string,
  { isOutputShown = false }: { isOutputShown?: boolean } = {},
): Prerequisite {
  return {
    name,
    findProblem: async () => {
      const result = await runCommand(command);
      if (result.exitCode === 0) {
        return undefined;
      }
      return isOutputShown ? `${message}:\n\n${result.output.trim()}` : message;
    },
  };
}

function turboRun(task: string): [string, ...string[]] {
  return ["pnpm", "exec", "turbo", "run", task, "--output-logs=errors-only"];
}

/**
 * Turbo marks a package affected when its files or a dependency's files changed relative to the
 * merge base with `origin/main`, uncommitted changes included.
 */
async function findAffectedPackages(): Promise<string[]> {
  const stdout = await runCommandOrThrow(
    ["pnpm", "exec", "turbo", "ls", "--affected", "--output=json"],
    { env: { ...process.env, TURBO_SCM_BASE: AFFECTED_BASE } },
  );
  const listing = TURBO_LS_OUTPUT.parse(JSON.parse(stdout));
  return listing.packages.items.map((item) => item.name);
}
