import process from "node:process";
import { z } from "zod";

import { runCommand } from "#src/run-command.ts";

type Prerequisite = {
  /** Names what is missing when the check fails, such as "Docker is not running". */
  missingMessage: string;
  isMet: () => Promise<boolean>;
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

const DOCKER_RUNNING: Prerequisite = {
  missingMessage: "Docker is not running (`docker info` failed); start Docker Desktop.",
  isMet: async () => (await runCommand(["docker", "info"])).exitCode === 0,
};
const UVX_INSTALLED: Prerequisite = {
  missingMessage: "`uvx` is not installed (`uvx --version` failed); zizmor runs through it.",
  isMet: async () => (await runCommand(["uvx", "--version"])).exitCode === 0,
};
const GH_AUTHENTICATED: Prerequisite = {
  missingMessage:
    "GitHub CLI is not authenticated (`gh auth status` failed); zizmor needs its token. Run `gh auth login`.",
  isMet: async () => (await runCommand(["gh", "auth", "status"])).exitCode === 0,
};

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

/**
 * Each gate includes every step of the gate before it; a later gate extends its predecessor's
 * `prerequisites` and `steps` instead of repeating them.
 */
export const GATE_NAMES = ["review"] as const;

export type GateName = (typeof GATE_NAMES)[number];

export const GATES: Record<GateName, Gate> = { review: REVIEW_GATE };

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
