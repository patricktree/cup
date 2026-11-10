import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";

import { loadEvalCases } from "#test/evals/eval-cases.ts";

const EXPECTED_JSON = JSON.stringify([{ id: "narration-unit-0001", narrationText: "Title" }]);
const NARRATION_LANGUAGE_JSON = JSON.stringify([
  { declaredLanguage: { htmlLang: "en" }, expectedLanguage: "en" },
  { expectedLanguage: "en" },
]);

test("reads an optional source subtitle beside the source title", async () => {
  const casesDirectory = await createCasesDirectory({
    "source-title.txt": "Title\n",
    "source-subtitle.txt": "  The subtitle line.\n",
    "input.html": "<p>Body</p>",
    "expected.json": EXPECTED_JSON,
    "narration-language.json": NARRATION_LANGUAGE_JSON,
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
    "narration-language.json": NARRATION_LANGUAGE_JSON,
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
    "narration-language.json": NARRATION_LANGUAGE_JSON,
  });

  await expect(loadEvalCases(casesDirectory)).rejects.toThrow(
    /source-subtitle\.txt to contain a source subtitle/,
  );
});

test("reads the narration language scenarios", async () => {
  const casesDirectory = await createCasesDirectory({
    "source-title.txt": "Title\n",
    "input.html": "<p>Body</p>",
    "expected.json": EXPECTED_JSON,
    "narration-language.json": NARRATION_LANGUAGE_JSON,
  });

  const [evalCase] = await loadEvalCases(casesDirectory);

  expect(evalCase?.narrationLanguageScenarios).toEqual([
    { declaredLanguage: { htmlLang: "en" }, expectedLanguage: "en" },
    { expectedLanguage: "en" },
  ]);
});

test("rejects a case without narration-language.json", async () => {
  const casesDirectory = await createCasesDirectory({
    "source-title.txt": "Title\n",
    "input.html": "<p>Body</p>",
    "expected.json": EXPECTED_JSON,
  });

  await expect(loadEvalCases(casesDirectory)).rejects.toThrow(/narration-language\.json to exist/);
});

test.each([
  { name: "an empty scenario list", scenarios: [] },
  { name: "a region in the expected language", scenarios: [{ expectedLanguage: "de-AT" }] },
  { name: "an invalid expected language", scenarios: [{ expectedLanguage: "not a tag" }] },
  {
    name: "an unknown declared language field",
    scenarios: [{ declaredLanguage: { contentLanguage: "de" }, expectedLanguage: "de" }],
  },
  {
    name: "no scenario without a declared language",
    scenarios: [{ declaredLanguage: { htmlLang: "de" }, expectedLanguage: "de" }],
  },
])("rejects narration language scenarios with $name", async ({ scenarios }) => {
  const casesDirectory = await createCasesDirectory({
    "source-title.txt": "Title\n",
    "input.html": "<p>Body</p>",
    "expected.json": EXPECTED_JSON,
    "narration-language.json": JSON.stringify(scenarios),
  });

  await expect(loadEvalCases(casesDirectory)).rejects.toThrow(
    /Invalid narration language scenarios for eval case a-case/,
  );
});

test("loads every committed eval case, including its narration language scenarios", async () => {
  const committedCasesDirectory = path.join(import.meta.dirname, "cases");

  await expect(loadEvalCases(committedCasesDirectory)).resolves.not.toHaveLength(0);
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
