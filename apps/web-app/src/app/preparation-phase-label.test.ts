import { expect, test } from "@playwright/test";

import { audiobookSchema } from "@cup/listener-api.routes";

import { toPreparationPhaseLabel } from "#src/app/preparation-phase-label.ts";

const LABELS = [
  ["starting", "Starting"],
  ["reading-page", "Reading the page"],
  ["selecting-content", "Selecting narration content"],
  ["preparing-text", "Preparing the text"],
  [undefined, "Preparing"],
] as const;

for (const [preparationPhase, label] of LABELS) {
  test(`the ${preparationPhase ?? "missing"} preparation phase reads "${label}"`, () => {
    expect(toPreparationPhaseLabel(preparationPhase)).toBe(label);
  });
}

test('a preparation phase this client does not know reads "Preparing"', () => {
  const audiobook = audiobookSchema.parse({
    status: "pending",
    originalUrl: "https://example.com/",
    canGenerate: true,
    preparationPhase: "translating",
  });
  expect(audiobook.status).toBe("pending");
  expect(
    toPreparationPhaseLabel(
      audiobook.status === "pending" ? audiobook.preparationPhase : "starting",
    ),
  ).toBe("Preparing");
});

test("no label shows an ellipsis or a percentage", () => {
  for (const [preparationPhase] of LABELS) {
    expect(toPreparationPhaseLabel(preparationPhase)).not.toMatch(/…|\.\.\.|%/);
  }
});
