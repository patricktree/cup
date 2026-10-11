import { expect, test } from "vitest";

import {
  getSynthesisState,
  type GetSynthesisStateDependencies,
} from "#src/use-cases/get-synthesis-state.ts";

const CONVERSION_ID = "2f94d6a9-68eb-49eb-b88e-753cf5fba041";
const INPUT = {
  conversionId: CONVERSION_ID,
  origin: "https://cup.example",
  // Estimated at 1,000 and 8,000 milliseconds.
  narrationTextCharactersBySegment: [5, 100],
};

function createDependencies(
  usage: Awaited<ReturnType<GetSynthesisStateDependencies["listAudioSegments"]>>,
): GetSynthesisStateDependencies {
  return {
    listAudioSegments: async () => usage,
    getAvailableMilliseconds: async () => 4_000,
    getFailureExplanation: async (sequence) =>
      sequence === 1 ? "The provider rejected this text." : undefined,
  };
}

test("a document without reservations reports the duration it needs", async () => {
  await expect(getSynthesisState(INPUT, createDependencies([]))).resolves.toEqual({
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
      INPUT,
      createDependencies([
        { sequence: 0, state: "settled", actualMilliseconds: 900 },
        { sequence: 1, state: "reserved", actualMilliseconds: 0 },
      ]),
    ),
  ).resolves.toEqual({
    status: "synthesizing",
    segments: [
      {
        sequence: 0,
        status: "ready",
        durationMilliseconds: 900,
        url: `https://cup.example/api/files/audiobooks/${CONVERSION_ID}/segments/0/audio.mp3`,
      },
      { sequence: 1, status: "generating" },
    ],
  });
});

test("a conversion is ready once every segment has audio or a final failure", async () => {
  const state = await getSynthesisState(
    INPUT,
    createDependencies([
      { sequence: 0, state: "settled", actualMilliseconds: 900 },
      { sequence: 1, state: "released", actualMilliseconds: 0 },
    ]),
  );

  expect(state.status).toBe("ready");
  expect(state.segments[1]).toEqual({
    sequence: 1,
    status: "failed",
    explanation: "The provider rejected this text.",
  });
});
