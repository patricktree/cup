import path from "node:path";
import url from "node:url";
import util from "node:util";
import * as vitest from "vitest";
import { createJudge, describeEval } from "vitest-evals";

import { PRODUCTION_CONFIG } from "#src/production-narration-content-selection.ts";

import { loadEvalCases } from "#test/evals/eval-cases.ts";
import type { ExpectedSynchronizationUnits } from "#test/evals/eval-cases.ts";
import {
  createNarrationContentSelectionHarness,
  type NarrationContentSelectionCandidate,
  type NarrationContentSelectionEvalInput,
  type NarrationContentSelectionEvalOutput,
} from "#test/evals/narration-content-selection-harness.ts";

const CASES_DIRECTORY = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "cases");

const CANDIDATES: readonly NarrationContentSelectionCandidate[] = [
  {
    ...PRODUCTION_CONFIG,
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
            threshold: 1,
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
