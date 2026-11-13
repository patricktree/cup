import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { analyzeMp3 } from "#src/audio-format.ts";
import { countSynthesizedWords } from "#src/find-cut-point.ts";
import { getSpeechRecognitionLanguage } from "#src/speech-recognition-language.ts";

/** An overlap take of speech policy 7: the overlap sentence, the separator and the narration chunk. */
export type SpeechRecognitionCase = {
  id: string;
  description: string;
  tags: string[];
  /** The manifest's narration language; undefined lets Whisper detect the language. */
  narrationLanguage: string | undefined;
  /** Whisper's language code for the narration language, as production passes it. */
  recognitionLanguage: string | undefined;
  synthesizedText: string;
  chunkStartWordIndex: number;
  /** The silent run (≤ −45 dBFS) between the overlap sentence and the chunk that the cut must hit. */
  expectedPause: { startSeconds: number; endSeconds: number };
  /**
   * Set when the cut check is expected to reject the take, so that production synthesizes the chunk
   * alone, such as when Whisper's words cannot place the cut in the expected pause.
   */
  expectedRejection: "cut-check-failed" | undefined;
  /** The provider audio as MP3 frames in `AUDIO_FORMAT`. */
  providerMp3: Uint8Array;
};

const CASE_FILE_NAME = "case.json";
const PROVIDER_AUDIO_FILE_NAME = "provider-audio.mp3";
// the cut check's own minimum, so a pause the cut check would reject cannot be expected
const MIN_EXPECTED_PAUSE_SECONDS = 0.15;

const CASE_SCHEMA = z
  .object({
    description: z.string().nonempty(),
    tags: z.array(z.string().nonempty()),
    // null when the conversion has no narration language
    narrationLanguage: z
      .string()
      .nullable()
      .refine(
        (narrationLanguage) =>
          narrationLanguage === null ||
          getSpeechRecognitionLanguage(narrationLanguage) !== undefined,
        { message: "Expected a narration language that speech recognition supports, or null" },
      ),
    overlapSentence: z.string().nonempty(),
    // the separators synthesizeWithOverlapAndCut joins the overlap sentence and the chunk with
    separator: z.enum(["\n\n", " "]),
    narrationChunk: z.string().nonempty(),
    chunkStartWordIndex: z.int().nonnegative(),
    expectedPause: z
      .object({ startSeconds: z.number().nonnegative(), endSeconds: z.number() })
      .strict()
      .refine(
        ({ startSeconds, endSeconds }) => endSeconds - startSeconds >= MIN_EXPECTED_PAUSE_SECONDS,
        { message: `Expected a pause of at least ${MIN_EXPECTED_PAUSE_SECONDS} s` },
      ),
    expectedRejection: z.literal("cut-check-failed").exactOptional(),
  })
  .strict()
  .refine(
    ({ overlapSentence, chunkStartWordIndex }) =>
      chunkStartWordIndex === countSynthesizedWords(overlapSentence),
    {
      message: "Expected chunkStartWordIndex to count the overlap sentence's words",
      path: ["chunkStartWordIndex"],
    },
  )
  .refine(
    ({ overlapSentence, narrationLanguage }) =>
      countSentences(overlapSentence, narrationLanguage ?? undefined) === 1,
    {
      message: "Expected the overlap sentence to be one sentence, as production selects it",
      path: ["overlapSentence"],
    },
  );

export async function loadSpeechRecognitionCases(
  casesDirectory: string,
): Promise<SpeechRecognitionCase[]> {
  const entries = await fs.readdir(casesDirectory, { withFileTypes: true });

  if (entries.length === 0) {
    throw new Error(`Expected at least one speech recognition eval case in ${casesDirectory}`);
  }

  const caseEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  const cases: SpeechRecognitionCase[] = [];

  for (const entry of caseEntries) {
    if (!entry.isDirectory()) {
      throw new Error(
        `Expected ${path.join(casesDirectory, entry.name)} to be an eval case directory`,
      );
    }

    cases.push(await loadSpeechRecognitionCase(path.join(casesDirectory, entry.name), entry.name));
  }

  return cases;
}

async function loadSpeechRecognitionCase(
  caseDirectory: string,
  caseId: string,
): Promise<SpeechRecognitionCase> {
  const [caseJson, providerMp3] = await Promise.all([
    readCaseFile(path.join(caseDirectory, CASE_FILE_NAME)),
    readCaseFile(path.join(caseDirectory, PROVIDER_AUDIO_FILE_NAME)),
  ]);

  const parsedCase = CASE_SCHEMA.safeParse(JSON.parse(caseJson.toString("utf8")));
  if (!parsedCase.success) {
    throw new Error(
      `Invalid speech recognition eval case ${caseId}: ${z.prettifyError(parsedCase.error)}`,
    );
  }

  const audio = new Uint8Array(providerMp3);
  const { durationMilliseconds } = analyzeMp3(audio);
  const { expectedPause, narrationLanguage } = parsedCase.data;
  if (expectedPause.endSeconds * 1000 > durationMilliseconds) {
    throw new Error(
      `Expected the pause of speech recognition eval case ${caseId} to end within its ${durationMilliseconds} ms of provider audio`,
    );
  }

  return {
    id: caseId,
    description: parsedCase.data.description,
    tags: parsedCase.data.tags,
    narrationLanguage: narrationLanguage ?? undefined,
    recognitionLanguage:
      narrationLanguage === null ? undefined : getSpeechRecognitionLanguage(narrationLanguage),
    synthesizedText: `${parsedCase.data.overlapSentence}${parsedCase.data.separator}${parsedCase.data.narrationChunk}`,
    chunkStartWordIndex: parsedCase.data.chunkStartWordIndex,
    expectedPause,
    expectedRejection: parsedCase.data.expectedRejection,
    providerMp3: audio,
  };
}

async function readCaseFile(filePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    throw new Error(`Expected ${filePath} to exist`, { cause: error });
  }
}

/** Counts sentences as `synthesizeWithOverlapAndCut` segments the previous chunk to select one. */
function countSentences(text: string, narrationLanguage: string | undefined): number {
  const segmenter = new Intl.Segmenter(narrationLanguage, { granularity: "sentence" });
  return [...segmenter.segment(text)].filter(({ segment }) => segment.trim().length > 0).length;
}
