import { expect, test } from "vitest";

import {
  getSynthesisState,
  type GetSynthesisStateDependencies,
} from "#src/use-cases/get-synthesis-state.ts";

// Estimated at 1,000 and 8,000 milliseconds.
const NARRATION_TEXT_CHARACTERS_BY_SEGMENT = [5, 100];

const DEPENDENCIES: GetSynthesisStateDependencies = {
  getAvailableMilliseconds: async () => 4_000,
  getFailureExplanation: async (sequence) =>
    sequence === 1 ? "The provider rejected this text." : undefined,
};

test("a document without reservations reports the duration it needs", async () => {
  await expect(
    getSynthesisState(
      { narrationTextCharactersBySegment: NARRATION_TEXT_CHARACTERS_BY_SEGMENT, segmentUsage: [] },
      DEPENDENCIES,
    ),
  ).resolves.toEqual({
    status: "insufficient-duration",
    segments: [
      { sequence: 0, status: "absent" },
      { sequence: 1, status: "absent" },
    ],
    requiredMilliseconds: 9_000,
    availableMilliseconds: 4_000,
  });
});

test("a reserved segment keeps the conversion synthesizing", async () => {
  await expect(
    getSynthesisState(
      {
        narrationTextCharactersBySegment: NARRATION_TEXT_CHARACTERS_BY_SEGMENT,
        segmentUsage: [
          { sequence: 0, state: "settled" },
          { sequence: 1, state: "reserved" },
        ],
      },
      DEPENDENCIES,
    ),
  ).resolves.toEqual({
    status: "synthesizing",
    segments: [
      { sequence: 0, status: "ready" },
      { sequence: 1, status: "generating" },
    ],
  });
});

test("a conversion is ready once every segment has audio or a final failure", async () => {
  const state = await getSynthesisState(
    {
      narrationTextCharactersBySegment: NARRATION_TEXT_CHARACTERS_BY_SEGMENT,
      segmentUsage: [
        { sequence: 0, state: "settled" },
        { sequence: 1, state: "released" },
      ],
    },
    DEPENDENCIES,
  );

  expect(state.status).toBe("ready");
  expect(state.segments[1]).toEqual({
    sequence: 1,
    status: "failed",
    explanation: "The provider rejected this text.",
  });
});
