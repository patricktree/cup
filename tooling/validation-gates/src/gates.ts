import process from "node:process";
import { z } from "zod";

import { runCommand } from "#src/run-command.ts";

type Prerequisite = {
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
};

export type Gate = {
  name: string;
  prerequisites: Prerequisite[];
  steps: Step[];
};

const NARRATION_SOURCE_ANALYSIS = "@cup/narration-source-analysis";
/** The part of `turbo ls --output=json` the evals rule reads. */
const TURBO_LS_OUTPUT = z.object({
  packages: z.object({ items: z.array(z.object({ name: z.string() })) }),
});

const DOCKER_RUNNING = commandSucceeds(
  ["docker", "info"],
  "Docker is not running (`docker info` failed); start Docker Desktop.",
);
const UVX_INSTALLED = commandSucceeds(
  ["uvx", "--version"],
  "`uvx` is not installed (`uvx --version` failed); zizmor runs through it.",
);
const GH_AUTHENTICATED = commandSucceeds(
  ["gh", "auth", "status"],
  "GitHub CLI is not authenticated (`gh auth status` failed); zizmor needs its token. Run `gh auth login`.",
);

/**
 * The deploy gate runs on exactly the commit being deployed: a clean `main` equal to a freshly
 * fetched `origin/main`. Ignored files, such as `.env.local`, do not count as changes.
 */
const CHECKOUT_DEPLOYABLE: Prerequisite = {
  findProblem: async () => {
    const fetch = await runCommand(["git", "fetch", "origin"]);
    if (fetch.exitCode !== 0) {
      return `\`git fetch origin\` failed with exit code ${fetch.exitCode}:\n${fetch.output.trim()}`;
    }

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

    const changes = await runGit(["status", "--porcelain", "--untracked-files=no"]);
    if (changes.trim() !== "") {
      return `Tracked files have uncommitted changes; the deploy gate runs only on a clean checkout:\n\n\`\`\`\n${changes.trimEnd()}\n\`\`\``;
    }
    return undefined;
  },
};

/**
 * The mobile E2E suite's own preflight check per platform, run up front so that a missing toolchain
 * fails the deploy gate before its first step rather than after the web suites. `@cup/mobile-e2e`
 * exports no modules, so a child process imports the checks by path.
 */
const MOBILE_TOOLCHAINS_READY = commandSucceeds(
  [
    "node",
    "--input-type=module",
    "--eval",
    `
      const { checkAndroidHost } = await import("./qa/mobile-e2e/src/android/preflight.ts");
      const { checkIosHost } = await import("./qa/mobile-e2e/src/ios/preflight.ts");
      const results = await Promise.allSettled([checkAndroidHost(), checkIosHost()]);
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(result.reason instanceof Error ? result.reason.message : result.reason);
          process.exitCode = 1;
        }
      }
    `,
  ],
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
    {
      name: "Build, lint and test",
      /* Turbo cache hits are accepted, so no `--force`. */
      command: [
        "pnpm",
        "exec",
        "turbo",
        "run",
        "turbo:build",
        "turbo:lint",
        "turbo:test",
        "--output-logs=errors-only",
      ],
    },
    // Knip loads the Worker's Vite config, which requires the built web app, so it runs after the build.
    { name: "Knip", command: ["pnpm", "run", "declutter"] },
    { name: "Brand-assets check", command: ["pnpm", "run", "brand-assets:check"] },
    { name: "Zizmor", command: ["pnpm", "run", "zizmor"] },
    { name: "Source-material E2E", command: ["pnpm", "run", "test:e2e:source-material"] },
    {
      name: "Narration evals",
      command: ["pnpm", "run", "evals"],
      findSkipReason: async () =>
        (await findAffectedPackages()).includes(NARRATION_SOURCE_ANALYSIS)
          ? undefined
          : `\`${NARRATION_SOURCE_ANALYSIS}\` and its dependencies are not affected relative to \`main\``,
    },
  ],
};

/** Runs after approval on the head rebased onto a freshly fetched `origin/main`. */
const MERGE_GATE: Gate = {
  name: "merge",
  prerequisites: [...REVIEW_GATE.prerequisites],
  steps: [
    ...REVIEW_GATE.steps,
    /* Outside turbo, so the suite always runs fresh. */
    { name: "App E2E", command: ["pnpm", "run", "test:e2e:app"] },
  ],
};

/** Runs in the main checkout at exactly `origin/main`, right before a deploy. */
const DEPLOY_GATE: Gate = {
  name: "deploy",
  prerequisites: [CHECKOUT_DEPLOYABLE, ...MERGE_GATE.prerequisites, MOBILE_TOOLCHAINS_READY],
  steps: [
    ...MERGE_GATE.steps,
    /* One platform after the other until the parallel mobile runner has proven itself. */
    {
      name: "Mobile E2E (Android)",
      command: ["pnpm", "run", "test:e2e:mobile", "--project", "android"],
    },
    { name: "Mobile E2E (iOS)", command: ["pnpm", "run", "test:e2e:mobile", "--project", "ios"] },
  ],
};

/**
 * Each gate includes every step of the gate before it; a later gate extends its predecessor's
 * `prerequisites` and `steps` instead of repeating them.
 */
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
function commandSucceeds(
  command: [string, ...string[]],
  message: string,
  { isOutputShown = false }: { isOutputShown?: boolean } = {},
): Prerequisite {
  return {
    findProblem: async () => {
      const result = await runCommand(command);
      if (result.exitCode === 0) {
        return undefined;
      }
      return isOutputShown ? `${message}:\n\n${result.output.trim()}` : message;
    },
  };
}

/** Runs a git command that must succeed and returns its stdout. */
async function runGit(args: string[]): Promise<string> {
  const result = await runCommand(["git", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `\`git ${args.join(" ")}\` failed with exit code ${result.exitCode}:\n${result.output}`,
    );
  }
  return result.stdout;
}

/**
 * Turbo marks a package affected when its files or a dependency's files changed relative to the
 * merge base with `main`, uncommitted changes included.
 */
async function findAffectedPackages(): Promise<string[]> {
  const result = await runCommand(["pnpm", "exec", "turbo", "ls", "--affected", "--output=json"], {
    env: { ...process.env, TURBO_SCM_BASE: "main" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `\`turbo ls --affected\` failed with exit code ${result.exitCode}:\n${result.output}`,
    );
  }

  const listing = TURBO_LS_OUTPUT.parse(JSON.parse(result.stdout));
  return listing.packages.items.map((item) => item.name);
}
