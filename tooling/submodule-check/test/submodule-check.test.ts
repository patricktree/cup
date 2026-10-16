import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import type { TestContext } from "vitest";

import { runCli } from "#src/cli.ts";

/* drop variables such as GIT_DIR and GIT_INDEX_FILE that a surrounding git hook may have set */
const ENVIRONMENT = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]) {
  return childProcess.execFileSync("git", args, { cwd, env: ENVIRONMENT, encoding: "utf8" }).trim();
}

/**
 * Creates a superproject with a submodule `stack` whose history is `old` <- `middle` <- `new`, and
 * whose initial commit records `old`.
 */
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "submodule-check-"));
  t.onTestFinished(() => fs.rm(root, { recursive: true, force: true }));

  const stack = path.join(root, "stack");
  await fs.mkdir(stack);
  git(stack, "init", "--quiet", "--initial-branch=main");
  const submoduleCommits: Record<"old" | "middle" | "new", string> = {
    old: "",
    middle: "",
    new: "",
  };
  for (const name of ["old", "middle", "new"] as const) {
    git(stack, "commit", "--quiet", "--allow-empty", "--message", name);
    submoduleCommits[name] = git(stack, "rev-parse", "HEAD");
  }

  git(root, "init", "--quiet", "--initial-branch=main");
  await fs.writeFile(
    path.join(root, ".gitmodules"),
    '[submodule "stack"]\n\tpath = stack\n\turl = https://example.com/stack\n',
  );
  git(root, "add", ".gitmodules");

  const repository = {
    root,
    commits: submoduleCommits,
    git: (...args: string[]) => git(root, ...args),
    stage: (name: keyof typeof submoduleCommits) =>
      git(root, "update-index", "--add", "--cacheinfo", `160000,${submoduleCommits[name]},stack`),
    commit: (message: string) => {
      git(root, "commit", "--quiet", "--allow-empty", "--message", message);
      return git(root, "rev-parse", "HEAD");
    },
    setMain: (revision: string) => git(root, "update-ref", "refs/remotes/origin/main", revision),
    run: async (args: string[]) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const status = await runCli(args, root, ENVIRONMENT, {
        ...console,
        log: (message: string) => {
          stdout.push(message);
        },
        error: (message: string) => {
          stderr.push(message);
        },
      });
      return { status, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
    },
  };
  repository.stage("old");
  repository.commit("initial");
  return repository;
}

test("staged passes for an unchanged pointer even when origin/main is ahead", async (t) => {
  const repository = await fixture(t);
  repository.git("branch", "feature");
  repository.stage("new");
  repository.setMain(repository.commit("update stack on main"));
  repository.git("checkout", "--quiet", "feature");
  repository.stage("old");

  const result = await repository.run(["staged"]);
  assert.equal(result.status, 0, result.stderr);
});

test("staged passes for a forward move", async (t) => {
  const repository = await fixture(t);
  repository.setMain("HEAD");
  repository.stage("new");

  const result = await repository.run(["staged"]);
  assert.equal(result.status, 0, result.stderr);
});

test("staged rejects a move to an ancestor of HEAD's pointer with an actionable message", async (t) => {
  const repository = await fixture(t);
  repository.stage("new");
  repository.commit("update stack");
  repository.setMain("HEAD");
  repository.stage("middle");

  const result = await repository.run(["staged"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`from ${repository.commits.new} \\(HEAD\\)`));
  assert.match(result.stderr, new RegExp(`to   ${repository.commits.middle}`));
  assert.ok(
    result.stderr.includes(`git update-index --cacheinfo 160000,${repository.commits.new},stack`),
  );
  assert.ok(result.stderr.includes("git submodule update -- stack"));
});

test("staged rejects a move to an ancestor of origin/main's pointer", async (t) => {
  const repository = await fixture(t);
  repository.git("branch", "feature");
  repository.stage("new");
  repository.setMain(repository.commit("update stack on main"));
  repository.git("checkout", "--quiet", "feature");
  repository.stage("middle");

  const result = await repository.run(["staged"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`from ${repository.commits.new} \\(origin/main\\)`));
});

test("staged checks against HEAD only and says so when origin/main is unavailable", async (t) => {
  const repository = await fixture(t);
  repository.stage("new");
  repository.commit("update stack");
  repository.stage("middle");

  const result = await repository.run(["staged"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /origin\/main is unavailable/);
  assert.match(result.stderr, /\(HEAD\)/);
});

test("staged fails with a fetch instruction when the submodule lacks a commit", async (t) => {
  const repository = await fixture(t);
  repository.setMain("HEAD");
  repository.git(
    "update-index",
    "--cacheinfo",
    "160000,0123456789012345678901234567890123456789,stack",
  );

  const result = await repository.run(["staged"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lacks commit 0123456789012345678901234567890123456789/);
  assert.ok(result.stderr.includes("git -C stack fetch origin"));
});

test("staged fails with an init instruction when the submodule is not checked out", async (t) => {
  const repository = await fixture(t);
  repository.stage("new");
  await fs.rm(path.join(repository.root, "stack"), { recursive: true });

  const result = await repository.run(["staged"]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("git submodule update --init"));
});

test("commits rejects a commit that moves the pointer backwards, e.g. after a rebase", async (t) => {
  const repository = await fixture(t);
  repository.stage("new");
  repository.setMain(repository.commit("update stack on main"));
  repository.stage("middle");
  const backwardCommit = repository.commit("resolve conflicts");
  repository.commit("unrelated follow-up");

  const result = await repository.run(["commits", "HEAD"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`commit ${backwardCommit} \\(resolve conflicts\\)`));
  assert.match(result.stderr, new RegExp(`from ${repository.commits.new} \\(a parent commit\\)`));
});

test("commits passes for forward moves and ignores commits already on a remote", async (t) => {
  const repository = await fixture(t);
  repository.stage("new");
  repository.commit("update stack");
  repository.stage("middle");
  // already published, so not part of this push
  repository.setMain(repository.commit("downgrade stack on purpose"));
  repository.stage("new");
  repository.commit("update stack again");

  const result = await repository.run(["commits", "HEAD"]);
  assert.equal(result.status, 0, result.stderr);
});

test("staged rejects an unchanged pointer that the branch already moved behind origin/main", async (t) => {
  const repository = await fixture(t);
  repository.stage("new");
  repository.setMain(repository.commit("update stack on main"));
  repository.git("checkout", "--quiet", "-b", "feature", "refs/remotes/origin/main");
  repository.stage("middle");
  repository.git("commit", "--quiet", "--no-verify", "--message", "resolve conflicts");

  const result = await repository.run(["staged"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`from ${repository.commits.new} \\(origin/main\\)`));
});

test("commits rejects a merge that resolves to an older pointer, but passes a regular merge", async (t) => {
  const repository = await fixture(t);
  repository.git("branch", "feature");
  repository.stage("new");
  repository.setMain(repository.commit("update stack on main"));
  repository.git("checkout", "--quiet", "feature");
  repository.commit("feature work");

  repository.git("merge", "--quiet", "--no-edit", "refs/remotes/origin/main");
  assert.equal((await repository.run(["commits", "HEAD"])).status, 0);

  repository.git("reset", "--quiet", "--hard", "HEAD~1");
  repository.git("merge", "--quiet", "--no-edit", "--strategy=ours", "refs/remotes/origin/main");
  const mergeCommit = repository.git("rev-parse", "HEAD");
  const result = await repository.run(["commits", "HEAD"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`commit ${mergeCommit} `));
  assert.match(result.stderr, new RegExp(`to   ${repository.commits.old}`));
});
