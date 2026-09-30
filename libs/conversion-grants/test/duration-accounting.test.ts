import { expect, test } from "vitest";

import { estimateAudioDuration } from "#src/duration-accounting.ts";

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
