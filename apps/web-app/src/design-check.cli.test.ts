import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { runDesignCheckCli, type DesignCheckInputs } from "#src/design-check.cli.ts";

/** The PNG signature and the start of its IHDR chunk, which carries a 402×898 size. */
const PNG_HEADER = Buffer.from("89504e470d0a1a0a0000000d494844520000019200000382", "hex");

function setUp() {
  const workingDirectory = test.info().outputPath("cwd");
  fs.mkdirSync(path.join(workingDirectory, "designs"), { recursive: true });
  fs.writeFileSync(path.join(workingDirectory, "designs/start.png"), PNG_HEADER);

  const launches: DesignCheckInputs[] = [];
  const messages: string[] = [];
  return {
    workingDirectory,
    launches,
    messages,
    options: {
      workingDirectory,
      launch: async (inputs: DesignCheckInputs) => {
        launches.push(inputs);
        return 1;
      },
      output: {
        log: (message: string) => messages.push(message),
        error: (message: string) => messages.push(message),
      },
    },
  };
}

test("launches the check with the image resolved against the working directory", async () => {
  const { workingDirectory, launches, options } = setUp();

  const exitCode = await runDesignCheckCli(
    ["--story", "routes/index/LandingPage", "--image", "designs/start.png", "--ignore-top", "55"],
    options,
  );

  expect(launches).toEqual([
    {
      story: "routes/index/LandingPage",
      designImagePath: path.join(workingDirectory, "designs/start.png"),
      ignoreTopPixels: 55,
    },
  ]);
  // The launch's exit code, so a mismatch fails the command.
  expect(exitCode).toBe(1);
});

test("ignores no rows by default", async () => {
  const { launches, options } = setUp();

  await runDesignCheckCli(
    ["--story", "routes/index/LandingPage", "--image", "designs/start.png"],
    options,
  );

  expect(launches[0]?.ignoreTopPixels).toBe(0);
});

test("rejects an ignore height that is not a whole number of pixels", async () => {
  const { launches, messages, options } = setUp();

  const exitCode = await runDesignCheckCli(
    ["--story", "routes/index/LandingPage", "--image", "designs/start.png", "--ignore-top", "abc"],
    options,
  );

  expect(exitCode).not.toBe(0);
  expect(launches).toEqual([]);
  expect(messages.join("\n")).toContain("a whole number of pixels");
});

test("rejects a missing story", async () => {
  const { launches, messages, options } = setUp();

  const exitCode = await runDesignCheckCli(["--image", "designs/start.png"], options);

  expect(exitCode).not.toBe(0);
  expect(launches).toEqual([]);
  expect(messages.join("\n")).toContain("--story");
});

test("rejects an image that does not exist", async () => {
  const { launches, messages, options } = setUp();

  const exitCode = await runDesignCheckCli(
    ["--story", "routes/index/LandingPage", "--image", "designs/missing.png"],
    options,
  );

  expect(exitCode).not.toBe(0);
  expect(launches).toEqual([]);
  expect(messages.join("\n")).toContain("designs/missing.png");
});
