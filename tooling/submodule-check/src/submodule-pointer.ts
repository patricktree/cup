import childProcess from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import util from "node:util";

export type Environment = Record<string, string | undefined>;

export type CheckResult = { problems: string[]; notes: string[] };

const execFile = util.promisify(childProcess.execFile);
const MAIN_REF = "refs/remotes/origin/main";
const GITLINK_MODE = "160000";

/**
 * Checks the submodule pointers in the index (what `git commit` would record) against `HEAD` and
 * `origin/main`. Only pointers that the staged change moves are checked, so a branch that merely
 * predates a submodule update on main passes.
 */
export async function checkStaged(root: string, environment: Environment): Promise<CheckResult> {
  const git = createGit(root, environment);
  const submodulePaths = await readSubmodulePaths(git);
  if (submodulePaths.length === 0) {
    return { problems: [], notes: [] };
  }
  const mainPointers = await readMainPointers(git, submodulePaths);

  const stagedPointers = parsePointers(
    await git.run(["ls-files", "--stage", "-z", "--", ...submodulePaths]),
  );
  // exit code 1 means HEAD does not exist yet, i.e. this is the initial commit
  const hasHead =
    (await git.tryRun(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], [1])) !== undefined;
  const headPointers = hasHead
    ? parsePointers(await git.run(["ls-tree", "-z", "HEAD", "--", ...submodulePaths]))
    : new Map<string, string>();

  const moves: PointerMove[] = [];
  for (const [submodulePath, to] of stagedPointers) {
    const from = headPointers.get(submodulePath);
    if (from !== undefined && from !== to) {
      moves.push({ location: "the staged change", previousLabel: "HEAD", submodulePath, from, to });
    }
  }

  return {
    problems: await findBackwardMoves(git, environment, moves, mainPointers, "staged"),
    notes: mainPointers ? [] : [mainUnavailableNote("HEAD")],
  };
}

/**
 * Checks every commit reachable from the given revisions but not yet on any remote-tracking branch,
 * i.e. the commits a push would publish. This covers commits that bypass the pre-commit hook, such
 * as those `git rebase --continue` creates after conflict resolution.
 */
export async function checkCommits(
  root: string,
  environment: Environment,
  revisions: string[],
): Promise<CheckResult> {
  const git = createGit(root, environment);
  const submodulePaths = await readSubmodulePaths(git);
  if (submodulePaths.length === 0) {
    return { problems: [], notes: [] };
  }
  const mainPointers = await readMainPointers(git, submodulePaths);

  const log = await git.run([
    "log",
    "--format=commit%x09%H%x09%s",
    "--raw",
    "--no-abbrev",
    "--diff-merges=first-parent",
    ...revisions,
    "--not",
    "--remotes",
    "--",
    ...submodulePaths,
  ]);

  const moves: PointerMove[] = [];
  let location = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("commit\t")) {
      const [, oid, subject] = line.split("\t");
      location = `commit ${oid} (${subject})`;
      continue;
    }
    // e.g. `:160000 160000 <old oid> <new oid> M\t.patricktree-stack`
    const match = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) \w+\t(.+)$/.exec(line);
    if (match?.[1] === GITLINK_MODE && match[2] === GITLINK_MODE) {
      moves.push({
        location,
        previousLabel: "its parent",
        from: match[3]!,
        to: match[4]!,
        submodulePath: match[5]!,
      });
    }
  }

  return {
    problems: await findBackwardMoves(git, environment, moves, mainPointers, "commit"),
    notes: mainPointers ? [] : [mainUnavailableNote("each commit's parent")],
  };
}

type Git = {
  run: (args: string[]) => Promise<string>;
  /** Like `run`, but resolves to `undefined` when git exits with one of the expected codes. */
  tryRun: (args: string[], expectedExitCodes: number[]) => Promise<string | undefined>;
};

type PointerMove = {
  location: string;
  previousLabel: string;
  submodulePath: string;
  from: string;
  to: string;
};

function createGit(cwd: string, environment: Environment): Git {
  const run = async (args: string[]) => {
    const { stdout } = await execFile("git", args, {
      cwd,
      env: environment,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  };
  return {
    run,
    tryRun: async (args, expectedExitCodes) => {
      try {
        return await run(args);
      } catch (error) {
        if (isExecError(error) && expectedExitCodes.includes(error.code)) {
          return undefined;
        }
        throw error;
      }
    },
  };
}

function isExecError(error: unknown): error is { code: number } {
  return error instanceof Error && "code" in error && typeof error.code === "number";
}

async function readSubmodulePaths(git: Git): Promise<string[]> {
  // exit code 1 means .gitmodules declares no submodule paths
  const output = await git.tryRun(
    ["config", "--file", ".gitmodules", "--get-regexp", String.raw`^submodule\..*\.path$`],
    [1],
  );
  return (output ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(line.indexOf(" ") + 1));
}

async function readMainPointers(git: Git, submodulePaths: string[]) {
  const mainCommit = await git.tryRun(
    ["rev-parse", "--verify", "--quiet", `${MAIN_REF}^{commit}`],
    [1],
  );
  if (mainCommit === undefined) {
    return undefined;
  }
  return parsePointers(await git.run(["ls-tree", "-z", MAIN_REF, "--", ...submodulePaths]));
}

/**
 * Parses NUL-terminated `git ls-files --stage -z` and `git ls-tree -z` output into gitlink
 * pointers.
 */
function parsePointers(output: string): Map<string, string> {
  const pointers = new Map<string, string>();
  for (const entry of output.split("\0").filter(Boolean)) {
    const tabIndex = entry.indexOf("\t");
    const [mode, typeOrOid, oidOrStage] = entry.slice(0, tabIndex).split(" ");
    if (mode !== GITLINK_MODE) {
      continue;
    }
    // ls-tree prints `<mode> commit <oid>`, ls-files prints `<mode> <oid> <stage>`
    const oid = typeOrOid === "commit" ? oidOrStage : typeOrOid;
    pointers.set(entry.slice(tabIndex + 1), oid!);
  }
  return pointers;
}

async function findBackwardMoves(
  git: Git,
  environment: Environment,
  moves: PointerMove[],
  mainPointers: Map<string, string> | undefined,
  mode: "staged" | "commit",
): Promise<string[]> {
  const problems: string[] = [];
  for (const move of moves) {
    const baselines = new Map<string, string>([[move.from, move.previousLabel]]);
    const mainPointer = mainPointers?.get(move.submodulePath);
    if (mainPointer !== undefined && mainPointer !== move.to && !baselines.has(mainPointer)) {
      baselines.set(mainPointer, "origin/main");
    }

    const submoduleGit = await createSubmoduleGit(git, environment, move.submodulePath);
    if (typeof submoduleGit === "string") {
      problems.push(submoduleGit);
      continue;
    }

    const missingCommits: string[] = [];
    for (const oid of [move.to, ...baselines.keys()]) {
      if (
        (await submoduleGit.tryRun(["cat-file", "-e", `${oid}^{commit}`], [1, 128])) === undefined
      ) {
        missingCommits.push(oid);
      }
    }
    if (missingCommits.length > 0) {
      problems.push(
        [
          `${move.submodulePath}: cannot check ${move.location}, because the submodule checkout lacks commit ${missingCommits.join(" and ")}.`,
          `Fetch them with \`git -C ${move.submodulePath} fetch origin\` (or \`git submodule update\`) and retry.`,
        ].join("\n"),
      );
      continue;
    }

    for (const [baseline, label] of baselines) {
      // exit code 0 means `to` is an ancestor of the baseline, 1 means it is not
      const isAncestor =
        (await submoduleGit.tryRun(["merge-base", "--is-ancestor", move.to, baseline], [1])) !==
        undefined;
      if (isAncestor) {
        problems.push(describeBackwardMove(move, baseline, label, mode));
        break;
      }
    }
  }
  return problems;
}

/**
 * Returns a git runner for the submodule repository, or a problem description if it is not checked
 * out.
 */
async function createSubmoduleGit(
  git: Git,
  environment: Environment,
  submodulePath: string,
): Promise<Git | string> {
  const superprojectRoot = (await git.run(["rev-parse", "--show-toplevel"])).trim();
  const submoduleRoot = path.join(superprojectRoot, submodulePath);

  // variables like GIT_INDEX_FILE and GIT_DIR, which git sets for hooks, would redirect submodule
  // commands to the superproject's repository
  const localVariables = new Set((await git.run(["rev-parse", "--local-env-vars"])).split("\n"));
  const submoduleEnvironment = Object.fromEntries(
    Object.entries(environment).filter(([name]) => !localVariables.has(name)),
  );
  const submoduleGit = createGit(submoduleRoot, submoduleEnvironment);

  const notCheckedOut = `${submodulePath}: the submodule is not checked out. Run \`git submodule update --init\` and retry.`;
  const submoduleRealPath = await fs.realpath(submoduleRoot).catch(() => undefined);
  if (submoduleRealPath === undefined) {
    return notCheckedOut;
  }
  // an uninitialized submodule directory resolves to the superproject's repository
  const toplevel = (await submoduleGit.run(["rev-parse", "--show-toplevel"])).trim();
  if ((await fs.realpath(toplevel)) !== submoduleRealPath) {
    return notCheckedOut;
  }
  return submoduleGit;
}

function describeBackwardMove(
  move: PointerMove,
  baseline: string,
  label: string,
  mode: "staged" | "commit",
): string {
  const fix =
    mode === "staged"
      ? [
          `Stage the newer commit and sync the checkout:`,
          `  git update-index --cacheinfo ${GITLINK_MODE},${baseline},${move.submodulePath}`,
          `  git submodule update -- ${move.submodulePath}`,
        ]
      : [
          `Rewrite that commit (amend it, or \`git rebase -i\` and mark it \`edit\`) to record the newer commit:`,
          `  git update-index --cacheinfo ${GITLINK_MODE},${baseline},${move.submodulePath}`,
          `Then sync the checkout with \`git submodule update -- ${move.submodulePath}\`.`,
        ];
  return [
    `${move.submodulePath}: ${move.location} moves the submodule pointer backwards`,
    `  from ${baseline} (${label})`,
    `  to   ${move.to}, which is an ancestor of it.`,
    `This usually means a lagging submodule checkout was staged, e.g. by \`git add -A\` during conflict resolution.`,
    ...fix,
    `If the downgrade is intended, bypass the hook with \`--no-verify\`.`,
  ].join("\n");
}

function mainUnavailableNote(comparedAgainst: string) {
  return `${MAIN_REF} is unavailable; submodule pointers were compared against ${comparedAgainst} only.`;
}
