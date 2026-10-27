import { expect, test } from "@playwright/test";

import { clampToTimeline, findUnitIndexAt } from "#src/app/player/audiobook-timeline.ts";

const TIMELINE = { startMilliseconds: [0, 20_000, 30_000], durationMilliseconds: 35_000 };

test("the current unit is the last one starting at or before a position", () => {
  expect(findUnitIndexAt(TIMELINE, 0)).toBe(0);
  expect(findUnitIndexAt(TIMELINE, 19_999)).toBe(0);
  // A boundary belongs to the unit that starts there.
  expect(findUnitIndexAt(TIMELINE, 20_000)).toBe(1);
  expect(findUnitIndexAt(TIMELINE, 29_999)).toBe(1);
  expect(findUnitIndexAt(TIMELINE, 30_000)).toBe(2);
  expect(findUnitIndexAt(TIMELINE, 99_000)).toBe(2);
  expect(findUnitIndexAt(TIMELINE, -5)).toBe(0);
});

test("a position outside the narration track is clamped to one that does not end it", () => {
  expect(clampToTimeline(TIMELINE, -5)).toBe(0);
  expect(clampToTimeline(TIMELINE, 27_500)).toBe(27_500);
  expect(clampToTimeline(TIMELINE, 35_000)).toBe(34_999);
  expect(clampToTimeline(TIMELINE, 99_000)).toBe(34_999);
});
