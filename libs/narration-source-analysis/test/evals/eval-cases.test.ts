import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";

import { loadEvalCases } from "#test/evals/eval-cases.ts";

const EXPECTED_JSON = JSON.stringify([{ id: "narration-unit-0001", narrationText: "Title" }]);

test("reads an optional source subtitle beside the source title", async () => {
  const casesDirectory = await createCasesDirectory({
    "source-title.txt": "Title\n",
    "source-subtitle.txt": "  The subtitle line.\n",
    "input.html": "<p>Body</p>",
    "expected.json": EXPECTED_JSON,
  });

  const [evalCase] = await loadEvalCases(casesDirectory);

  expect(evalCase?.sourceTitle).toBe("Title");
  expect(evalCase?.sourceSubtitle).toBe("The subtitle line.");
});

test("leaves the source subtitle absent when the case has no source subtitle file", async () => {
  const casesDirectory = await createCasesDirectory({
    "source-title.txt": "Title\n",
    "input.html": "<p>Body</p>",
    "expected.json": EXPECTED_JSON,
  });

  const [evalCase] = await loadEvalCases(casesDirectory);

  expect(evalCase).not.toHaveProperty("sourceSubtitle");
});

test("rejects an empty source subtitle file", async () => {
  const casesDirectory = await createCasesDirectory({
    "source-title.txt": "Title\n",
    "source-subtitle.txt": " \n",
    "input.html": "<p>Body</p>",
    "expected.json": EXPECTED_JSON,
  });

  await expect(loadEvalCases(casesDirectory)).rejects.toThrow(
    /source-subtitle\.txt to contain a source subtitle/,
  );
});

async function createCasesDirectory(files: Record<string, string>): Promise<string> {
  const casesDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eval-cases-"));
  onTestFinished(() => fs.rm(casesDirectory, { recursive: true, force: true }));

  const caseDirectory = path.join(casesDirectory, "a-case");
  await fs.mkdir(caseDirectory);

  for (const [fileName, content] of Object.entries(files)) {
    await fs.writeFile(path.join(caseDirectory, fileName), content);
  }

  return casesDirectory;
}
