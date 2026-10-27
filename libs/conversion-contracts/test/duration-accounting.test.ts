import { expect, test } from "vitest";

import {
  estimateAudioDuration,
  findNarrationTrackDurations,
  layOutConsecutively,
} from "#src/duration-accounting.ts";

test("reserves 80 seconds per 1,000 characters with a one-second minimum", () => {
  expect(estimateAudioDuration(1_000)).toBe(80_000);
  expect(estimateAudioDuration(2_000)).toBe(160_000);
  expect(estimateAudioDuration(100)).toBe(8_000);
  expect(estimateAudioDuration(1)).toBe(1_000);
});

test.each([0, -1, 1.5, NaN, Infinity])(
  "rejects invalid narration character count %s",
  (characters) => {
    expect(() => estimateAudioDuration(characters)).toThrow(
      "Narration character count must be a positive safe integer",
    );
  },
);

test("a narration track has the settled durations of every segment in sequence order", () => {
  expect(
    findNarrationTrackDurations([
      { sequence: 2, state: "settled", actualMilliseconds: 24 },
      { sequence: 0, state: "settled", actualMilliseconds: 48 },
      { sequence: 1, state: "settled", actualMilliseconds: 72 },
    ]),
  ).toEqual([48, 72, 24]);
});

test.each([
  ["no segments", []],
  [
    "a reserved segment",
    [
      { sequence: 0, state: "settled", actualMilliseconds: 48 },
      { sequence: 1, state: "reserved", actualMilliseconds: 0 },
    ],
  ],
  [
    "a failed segment",
    [
      { sequence: 0, state: "released", actualMilliseconds: 0 },
      { sequence: 1, state: "settled", actualMilliseconds: 48 },
    ],
  ],
] as const)("no narration track exists with %s", (_, usage) => {
  expect(findNarrationTrackDurations(usage)).toBeUndefined();
});

test("rejects settled segments whose sequences leave a gap", () => {
  expect(() =>
    findNarrationTrackDurations([
      { sequence: 0, state: "settled", actualMilliseconds: 48 },
      { sequence: 2, state: "settled", actualMilliseconds: 48 },
    ]),
  ).toThrow("Narration track segments must have consecutive sequences from 0");
});

test("lays lengths end to end, each starting at the sum of the lengths before it", () => {
  expect(layOutConsecutively([48, 72, 24])).toEqual({
    startOffsets: [0, 48, 120],
    totalLength: 144,
  });
});

test("laying out no lengths has no start offsets and a total length of 0", () => {
  expect(layOutConsecutively([])).toEqual({ startOffsets: [], totalLength: 0 });
});
