import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { findWorkingDirectory, runFidelityCheckCli } from "#scripts/fidelity-check/cli.ts";
import {
  readFidelityCheckEnvironment,
  toFidelityCheckEnvironment,
  type FidelityCheckInputs,
} from "#scripts/fidelity-check/inputs.ts";

/** The PNG signature and the start of its IHDR chunk, which carries a 402×898 size. */
const PNG_HEADER = Buffer.from("89504e470d0a1a0a0000000d494844520000019200000382", "hex");
const STORY = "routes/index/LandingPage";

function setUp() {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-check-cli-"));
  fs.mkdirSync(path.join(workingDirectory, "designs"));
  fs.writeFileSync(path.join(workingDirectory, "designs/start.png"), PNG_HEADER);
  fs.writeFileSync(path.join(workingDirectory, "designs/start.jpg"), "not a png");

  const launches: Array<{ inputs: FidelityCheckInputs; playwrightArgs: string[] }> = [];
  const messages: string[] = [];
  return {
    workingDirectory,
    launches,
    output: () => messages.join("\n"),
    dependencies: {
      workingDirectory,
      launch: async (inputs: FidelityCheckInputs, playwrightArgs: string[]) => {
        launches.push({ inputs, playwrightArgs });
        return 1;
      },
      output: {
        log: (message: string) => messages.push(message),
        error: (message: string) => messages.push(message),
      },
    },
  };
}

await test("launches the check with the image resolved against the working directory", async () => {
  const { workingDirectory, launches, dependencies } = setUp();

  const exitCode = await runFidelityCheckCli(
    ["--story", STORY, "--image", "designs/start.png", "--ignore-top", "55"],
    dependencies,
  );

  assert.deepEqual(launches, [
    {
      inputs: {
        story: STORY,
        designImagePath: path.join(workingDirectory, "designs/start.png"),
        ignoreTopPixels: 55,
      },
      playwrightArgs: [],
    },
  ]);
  // The launch's exit code, so a mismatch fails the command.
  assert.equal(exitCode, 1);
});

await test("ignores no rows by default", async () => {
  const { launches, dependencies } = setUp();

  await runFidelityCheckCli(["--story", STORY, "--image", "designs/start.png"], dependencies);

  assert.equal(launches[0]?.inputs.ignoreTopPixels, 0);
});

await test("passes the arguments after -- on to Playwright", async () => {
  const { launches, dependencies } = setUp();

  await runFidelityCheckCli(
    ["--story", STORY, "--image", "designs/start.png", "--", "--headed", "--trace", "on"],
    dependencies,
  );

  assert.deepEqual(launches[0]?.playwrightArgs, ["--headed", "--trace", "on"]);
});

await test("prints its options for --help", async () => {
  const { launches, output, dependencies } = setUp();

  const exitCode = await runFidelityCheckCli(["--help"], dependencies);

  assert.equal(exitCode, 0);
  assert.deepEqual(launches, []);
  assert.match(output(), /--ignore-top <pixels>/);
});

for (const ignoreTop of ["abc", "", "1e2", "0x10", "-1", "1.5"]) {
  await test(`rejects the ignore height ${JSON.stringify(ignoreTop)}`, async () => {
    const { launches, output, dependencies } = setUp();

    const exitCode = await runFidelityCheckCli(
      ["--story", STORY, "--image", "designs/start.png", "--ignore-top", ignoreTop],
      dependencies,
    );

    assert.notEqual(exitCode, 0);
    assert.deepEqual(launches, []);
    assert.match(output(), /a whole number of pixels/);
  });
}

await test("rejects a missing story", async () => {
  const { launches, output, dependencies } = setUp();

  const exitCode = await runFidelityCheckCli(["--image", "designs/start.png"], dependencies);

  assert.notEqual(exitCode, 0);
  assert.deepEqual(launches, []);
  assert.match(output(), /--story/);
});

for (const [description, image, message] of [
  ["an image that does not exist", "designs/missing.png", "designs/missing.png"],
  ["a folder", "designs", "is no file"],
  ["an image that is not a PNG", "designs/start.jpg", "must be a PNG"],
] as const) {
  await test(`rejects ${description}, with the usage`, async () => {
    const { launches, output, dependencies } = setUp();

    const exitCode = await runFidelityCheckCli(["--story", STORY, "--image", image], dependencies);

    assert.notEqual(exitCode, 0);
    assert.deepEqual(launches, []);
    assert.ok(output().includes(message), output());
    assert.match(output(), /Usage: fidelity-check/);
  });
}

await test("hands the run the same inputs through its environment", () => {
  const inputs = { story: STORY, designImagePath: "/designs/start.png", ignoreTopPixels: 55 };

  assert.deepEqual(readFidelityCheckEnvironment(toFidelityCheckEnvironment(inputs)), inputs);
});

await test("refuses a run started without the command's checked inputs", () => {
  assert.throws(() => readFidelityCheckEnvironment({}), /fidelity-check --help/);
  assert.throws(
    () =>
      readFidelityCheckEnvironment({
        ...toFidelityCheckEnvironment({
          story: STORY,
          designImagePath: "/d.png",
          ignoreTopPixels: 0,
        }),
        FIDELITY_CHECK_IGNORE_TOP: "abc",
      }),
    /a whole number of pixels/,
  );
});

await test("starts relative paths where pnpm was typed, but only for this script", () => {
  const pnpmScript = { INIT_CWD: "/typed/here", npm_lifecycle_event: "fidelity-check" };

  assert.equal(findWorkingDirectory(pnpmScript, "/package"), "/typed/here");
  // An INIT_CWD left over from another pnpm script says nothing about this command.
  assert.equal(
    findWorkingDirectory({ INIT_CWD: "/elsewhere", npm_lifecycle_event: "dev" }, "/here"),
    "/here",
  );
  assert.equal(findWorkingDirectory({}, "/here"), "/here");
});
