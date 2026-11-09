import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { SYNCHRONIZATION_UNIT_SCHEMA } from "@cup/narration-document-creation";

const CASE_METADATA_SCHEMA = z
  .object({
    description: z.string().nonempty(),
    tags: z.array(z.string().nonempty()),
  })
  .strict();

const EXPECTED_SYNCHRONIZATION_UNITS_SCHEMA = z.array(SYNCHRONIZATION_UNIT_SCHEMA).min(1);

const NARRATION_LANGUAGE_SCENARIOS_SCHEMA = z
  .array(
    z
      .object({
        // As source preparation captures it from the live page; absent when nothing is declared.
        declaredLanguage: z
          .object({ htmlLang: z.string().exactOptional(), ogLocale: z.string().exactOptional() })
          .strict()
          .exactOptional(),
        expectedLanguage: z.string().refine(isLanguageSubtag, {
          message: "Expected a canonical BCP 47 language subtag without a region, such as de",
        }),
      })
      .strict(),
  )
  .min(1)
  .refine((scenarios) => scenarios.some((scenario) => scenario.declaredLanguage === undefined), {
    message: "Expected a scenario without a declared language",
  });

class EvalCaseLoadingError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

export type CaseMetadata = z.infer<typeof CASE_METADATA_SCHEMA>;
export type ExpectedSynchronizationUnits = z.infer<typeof EXPECTED_SYNCHRONIZATION_UNITS_SCHEMA>;
export type NarrationLanguageScenario = z.infer<typeof NARRATION_LANGUAGE_SCENARIOS_SCHEMA>[number];

export type EvalCase = {
  id: string;
  sourceTitle: string;
  sourceSubtitle?: string;
  inputHtml: string;
  expectedSynchronizationUnits: ExpectedSynchronizationUnits;
  expectedSynchronizationUnitsPath: string;
  narrationLanguageScenarios: NarrationLanguageScenario[];
  metadata?: CaseMetadata;
};

export async function loadEvalCases(casesDirectory: string): Promise<EvalCase[]> {
  const entries = await fs.readdir(casesDirectory, { withFileTypes: true });

  if (entries.length === 0) {
    throw new Error(`Expected at least one eval case in ${casesDirectory}`);
  }

  const caseEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  const cases: EvalCase[] = [];

  for (const entry of caseEntries) {
    if (!entry.isDirectory()) {
      throw new Error(
        `Expected ${path.join(casesDirectory, entry.name)} to be an eval case directory`,
      );
    }

    cases.push(await loadEvalCase(casesDirectory, entry.name));
  }

  return cases;
}

async function loadEvalCase(casesDirectory: string, caseId: string): Promise<EvalCase> {
  const caseDirectory = path.join(casesDirectory, caseId);
  const sourceTitlePath = path.join(caseDirectory, "source-title.txt");
  const sourceSubtitlePath = path.join(caseDirectory, "source-subtitle.txt");
  const inputHtmlPath = path.join(caseDirectory, "input.html");
  const expectedSynchronizationUnitsPath = path.join(caseDirectory, "expected.json");
  const narrationLanguageScenariosPath = path.join(caseDirectory, "narration-language.json");
  const metadataPath = path.join(caseDirectory, "case.json");

  await requireFile(sourceTitlePath);
  await requireFile(inputHtmlPath);
  await requireFile(expectedSynchronizationUnitsPath);
  await requireFile(narrationLanguageScenariosPath);

  const [
    sourceTitle,
    sourceSubtitle,
    inputHtml,
    expectedSynchronizationUnitsJson,
    narrationLanguageScenariosJson,
    metadata,
  ] = await Promise.all([
    fs.readFile(sourceTitlePath, "utf8"),
    loadSourceSubtitle(sourceSubtitlePath),
    fs.readFile(inputHtmlPath, "utf8"),
    fs.readFile(expectedSynchronizationUnitsPath, "utf8"),
    fs.readFile(narrationLanguageScenariosPath, "utf8"),
    loadMetadata(metadataPath, caseId),
  ]);

  const normalizedSourceTitle = sourceTitle.trim();

  if (normalizedSourceTitle.length === 0) {
    throw new Error(`Expected ${sourceTitlePath} to contain a source title`);
  }

  return {
    id: caseId,
    sourceTitle: normalizedSourceTitle,
    ...(sourceSubtitle === undefined ? {} : { sourceSubtitle }),
    inputHtml,
    expectedSynchronizationUnits: parseExpectedSynchronizationUnits(
      expectedSynchronizationUnitsJson,
      caseId,
    ),
    expectedSynchronizationUnitsPath,
    narrationLanguageScenarios: parseNarrationLanguageScenarios(
      narrationLanguageScenariosJson,
      caseId,
    ),
    ...(metadata ? { metadata } : {}),
  };
}

function parseExpectedSynchronizationUnits(
  expectedSynchronizationUnitsJson: string,
  caseId: string,
): ExpectedSynchronizationUnits {
  try {
    return EXPECTED_SYNCHRONIZATION_UNITS_SCHEMA.parse(
      JSON.parse(expectedSynchronizationUnitsJson),
    );
  } catch (error) {
    throw new EvalCaseLoadingError(
      `Invalid expected synchronization units for eval case ${caseId}`,
      error,
    );
  }
}

function parseNarrationLanguageScenarios(
  narrationLanguageScenariosJson: string,
  caseId: string,
): NarrationLanguageScenario[] {
  try {
    return NARRATION_LANGUAGE_SCENARIOS_SCHEMA.parse(JSON.parse(narrationLanguageScenariosJson));
  } catch (error) {
    throw new EvalCaseLoadingError(
      `Invalid narration language scenarios for eval case ${caseId}`,
      error,
    );
  }
}

function isLanguageSubtag(tag: string): boolean {
  try {
    return new Intl.Locale(tag).toString() === tag && new Intl.Locale(tag).language === tag;
  } catch {
    return false;
  }
}

async function requireFile(filePath: string): Promise<void> {
  try {
    const file = await fs.stat(filePath);

    if (!file.isFile()) {
      throw new Error(`Expected ${filePath} to be a file`);
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new EvalCaseLoadingError(`Expected ${filePath} to exist`, error);
    }

    throw error;
  }
}

async function loadSourceSubtitle(sourceSubtitlePath: string): Promise<string | undefined> {
  let sourceSubtitle: string;

  try {
    sourceSubtitle = await fs.readFile(sourceSubtitlePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }

  const normalizedSourceSubtitle = sourceSubtitle.trim();

  if (normalizedSourceSubtitle.length === 0) {
    throw new Error(
      `Expected ${sourceSubtitlePath} to contain a source subtitle; remove the file when the case has none`,
    );
  }

  return normalizedSourceSubtitle;
}

async function loadMetadata(
  metadataPath: string,
  caseId: string,
): Promise<CaseMetadata | undefined> {
  let metadataJson: string;

  try {
    metadataJson = await fs.readFile(metadataPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }

  try {
    return CASE_METADATA_SCHEMA.parse(JSON.parse(metadataJson));
  } catch (error) {
    throw new EvalCaseLoadingError(`Invalid metadata for eval case ${caseId}`, error);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
