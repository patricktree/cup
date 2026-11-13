import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";

import { loadSpeechRecognitionCases } from "#test/evals/speech-recognition-cases.ts";

const COMMITTED_CASES_DIRECTORY = path.join(import.meta.dirname, "cases");
const VALID_CASE = {
  description: "A heading before a paragraph.",
  tags: ["heading-overlap"],
  narrationLanguage: "en",
  overlapSentence: "Results",
  separator: "\n\n",
  narrationChunk: "The chunk begins.",
  chunkStartWordIndex: 1,
  expectedPause: { startSeconds: 0.5, endSeconds: 1 },
};

test("loads every committed speech recognition eval case with its provider audio", async () => {
  const cases = await loadSpeechRecognitionCases(COMMITTED_CASES_DIRECTORY);

  expect(cases).not.toHaveLength(0);
  for (const { synthesizedText, providerMp3 } of cases) {
    expect(synthesizedText).not.toBe("");
    expect(providerMp3).not.toHaveLength(0);
  }
});

test("joins the overlap sentence, the separator and the narration chunk into the synthesized text", async () => {
  const casesDirectory = await createCasesDirectory(VALID_CASE);

  const [speechRecognitionCase] = await loadSpeechRecognitionCases(casesDirectory);

  expect(speechRecognitionCase).toMatchObject({
    narrationLanguage: "en",
    recognitionLanguage: "en",
    synthesizedText: "Results\n\nThe chunk begins.",
    chunkStartWordIndex: 1,
    expectedRejection: undefined,
  });
});

test("loads a case whose overlap sentence ends with a citation marker, as production selects it", async () => {
  const casesDirectory = await createCasesDirectory({
    ...VALID_CASE,
    narrationLanguage: "de",
    overlapSentence: "am Anfang und als Schluss.[6]",
    chunkStartWordIndex: 5,
  });

  const [speechRecognitionCase] = await loadSpeechRecognitionCases(casesDirectory);

  expect(speechRecognitionCase?.synthesizedText).toBe(
    "am Anfang und als Schluss.[6]\n\nThe chunk begins.",
  );
});

test.each([
  {
    name: "a chunk start word index that does not count the overlap sentence's words",
    caseJson: { ...VALID_CASE, chunkStartWordIndex: 2 },
    error: /chunkStartWordIndex/,
  },
  {
    name: "an overlap sentence of two sentences",
    caseJson: { ...VALID_CASE, overlapSentence: "One. Two.", chunkStartWordIndex: 2 },
    error: /one sentence/,
  },
  {
    name: "a narration language speech recognition does not support",
    caseJson: { ...VALID_CASE, narrationLanguage: "rw" },
    error: /speech recognition supports/,
  },
  {
    name: "a pause shorter than the cut check accepts",
    caseJson: { ...VALID_CASE, expectedPause: { startSeconds: 0.5, endSeconds: 0.6 } },
    error: /at least 0.15 s/,
  },
  {
    name: "a pause beyond the provider audio",
    caseJson: { ...VALID_CASE, expectedPause: { startSeconds: 0.5, endSeconds: 60 } },
    error: /to end within its/,
  },
])("rejects a case with $name", async ({ caseJson, error }) => {
  const casesDirectory = await createCasesDirectory(caseJson);

  await expect(loadSpeechRecognitionCases(casesDirectory)).rejects.toThrow(error);
});

/** Creates a case directory with the case JSON and the provider audio of a committed case. */
async function createCasesDirectory(caseJson: unknown): Promise<string> {
  const casesDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "speech-recognition-cases-"));
  onTestFinished(() => fs.rm(casesDirectory, { recursive: true, force: true }));

  const caseDirectory = path.join(casesDirectory, "a-case");
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, "case.json"), JSON.stringify(caseJson));
  await fs.copyFile(
    path.join(COMMITTED_CASES_DIRECTORY, "en-heading-overlap", "provider-audio.mp3"),
    path.join(caseDirectory, "provider-audio.mp3"),
  );

  return casesDirectory;
}
