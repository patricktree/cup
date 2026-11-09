import path from "node:path";
import url from "node:url";
import util from "node:util";
import * as vitest from "vitest";
import { createJudge, describeEval } from "vitest-evals";

import { PRODUCTION_CONFIG } from "#src/production-narration-content-selection.ts";
import { PRODUCTION_DETECTION_CONFIG } from "#src/production-narration-language-detection.ts";

import { loadEvalCases } from "#test/evals/eval-cases.ts";
import type {
  EvalCase,
  ExpectedSynchronizationUnits,
  NarrationLanguageScenario,
} from "#test/evals/eval-cases.ts";
import {
  createNarrationContentSelectionHarness,
  type NarrationContentSelectionCandidate,
  type NarrationContentSelectionEvalInput,
  type NarrationContentSelectionEvalOutput,
} from "#test/evals/narration-content-selection-harness.ts";
import {
  createNarrationLanguageDetectionHarness,
  type NarrationLanguageDetectionCandidate,
  type NarrationLanguageDetectionEvalInput,
  type NarrationLanguageDetectionEvalOutput,
} from "#test/evals/narration-language-detection-harness.ts";

const CASES_DIRECTORY = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "cases");

const CANDIDATES: readonly NarrationContentSelectionCandidate[] = [
  {
    ...PRODUCTION_CONFIG,
    name: "production",
    role: "production",
  },
];

// Separate from the selection candidates, so detection experiments vary independently of selection.
const DETECTION_CANDIDATES: readonly NarrationLanguageDetectionCandidate[] = [
  {
    ...PRODUCTION_DETECTION_CONFIG,
    name: "production",
    role: "production",
  },
];

const EVAL_CASES = await loadEvalCases(CASES_DIRECTORY);

const EXACT_SYNCHRONIZATION_UNITS_JUDGE = createJudge<
  NarrationContentSelectionEvalInput,
  NarrationContentSelectionEvalOutput,
  { expectedSynchronizationUnits: ExpectedSynchronizationUnits }
>("exact-synchronization-units", ({ output, expectedSynchronizationUnits }) => {
  const isExactMatch = util.isDeepStrictEqual(
    output.synchronizationUnits,
    expectedSynchronizationUnits,
  );

  return {
    score: isExactMatch ? 1 : 0,
    metadata: {
      rationale: isExactMatch
        ? "Synchronization units match the committed golden"
        : "Synchronization units differ from the committed golden",
    },
  };
});

for (const candidate of CANDIDATES) {
  const harness = createNarrationContentSelectionHarness(candidate);

  describeEval(
    `narration content selection ${candidate.role} candidate: ${candidate.name}`,
    { harness },
    (test) => {
      for (const evalCase of EVAL_CASES) {
        test(evalCase.id, async ({ run }) => {
          const result = await run({
            sourceTitle: evalCase.sourceTitle,
            ...(evalCase.sourceSubtitle === undefined
              ? {}
              : { sourceSubtitle: evalCase.sourceSubtitle }),
            caseId: evalCase.id,
            inputHtml: evalCase.inputHtml,
            ...(evalCase.metadata ? { metadata: evalCase.metadata } : {}),
          });

          await vitest.expect(result).toSatisfyJudge(EXACT_SYNCHRONIZATION_UNITS_JUDGE, {
            expectedSynchronizationUnits: evalCase.expectedSynchronizationUnits,
            // Scores never gate: the file snapshot below gates the production candidate, so
            // `eval:update` can rewrite a golden that differs instead of failing before it.
            threshold: null,
          });

          if (candidate.role === "production") {
            await vitest
              .expect(`${JSON.stringify(result.output.synchronizationUnits, null, 2)}\n`)
              .toMatchFileSnapshot(evalCase.expectedSynchronizationUnitsPath);
          }
        });
      }
    },
  );
}

const EXACT_NARRATION_LANGUAGE_JUDGE = createJudge<
  NarrationLanguageDetectionEvalInput,
  NarrationLanguageDetectionEvalOutput,
  { expectedLanguage: string }
>("exact-narration-language", ({ output, expectedLanguage }) => {
  // A fallback answers with the declared language, which can match without the detector deciding.
  const isExactMatch = output.fallbackReason === undefined && output.language === expectedLanguage;

  return {
    score: isExactMatch ? 1 : 0,
    metadata: {
      rationale: isExactMatch
        ? "Detected language matches the expected language"
        : output.fallbackReason === undefined
          ? `Detected language ${output.language ?? "(none)"} differs from ${expectedLanguage}`
          : `Detection fell back with ${output.fallbackReason}`,
    },
  };
});

for (const candidate of DETECTION_CANDIDATES) {
  const harness = createNarrationLanguageDetectionHarness(candidate);

  describeEval(
    `narration language detection ${candidate.role} candidate: ${candidate.name}`,
    { harness },
    (test) => {
      for (const evalCase of EVAL_CASES) {
        for (const scenario of evalCase.narrationLanguageScenarios) {
          test(`${evalCase.id}: ${describeDeclaredLanguage(scenario)}`, async ({ run }) => {
            const result = await run({
              caseId: evalCase.id,
              sourceTitle: evalCase.sourceTitle,
              sourceMaterialHtml: toSourceMaterialHtml(evalCase),
              ...(scenario.declaredLanguage === undefined
                ? {}
                : { declaredLanguage: scenario.declaredLanguage }),
            });

            await vitest.expect(result).toSatisfyJudge(EXACT_NARRATION_LANGUAGE_JUDGE, {
              expectedLanguage: scenario.expectedLanguage,
              threshold: candidate.role === "production" ? 1 : null,
            });
          });
        }
      }
    },
  );
}

function describeDeclaredLanguage({ declaredLanguage }: NarrationLanguageScenario): string {
  const declarations = [
    ...(declaredLanguage?.htmlLang === undefined ? [] : [`htmlLang ${declaredLanguage.htmlLang}`]),
    ...(declaredLanguage?.ogLocale === undefined ? [] : [`ogLocale ${declaredLanguage.ogLocale}`]),
  ];

  return declarations.length === 0 ? "nothing declared" : `declared ${declarations.join(", ")}`;
}

/**
 * Rebuilds the narration source material from the committed selection golden, leaving out the
 * source title and source subtitle units, so a selection regression cannot fail detection.
 */
function toSourceMaterialHtml(evalCase: EvalCase): string {
  const leadingUnitCount = evalCase.sourceSubtitle === undefined ? 1 : 2;

  return evalCase.expectedSynchronizationUnits
    .slice(leadingUnitCount)
    .map((unit) => `<p>${escapeHtml(unit.narrationText)}</p>`)
    .join("\n");
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
