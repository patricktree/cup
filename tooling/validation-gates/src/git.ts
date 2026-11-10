import { runCommandOrThrow } from "#src/run-command.ts";

/** Runs a git command that must succeed and returns its stdout. */
export function runGit(args: string[]): Promise<string> {
  return runCommandOrThrow(["git", ...args]);
}

/**
 * Lists the tracked files with uncommitted changes in `git status --porcelain` format; an empty
 * string means a clean checkout. Untracked and ignored files, such as `.env.local`, do not count.
 */
export async function findTrackedChanges(): Promise<string> {
  return (await runGit(["status", "--porcelain", "--untracked-files=no"])).trimEnd();
}
