import { expect, test } from "@playwright/test";

import type { AudioSegment } from "@cup/listener-api.routes";

import {
  createAudiobookTimeline,
  findTimelineEntryIndex,
  locateTimelinePosition,
} from "#src/app/player/audiobook-timeline.ts";

const ready = (sequence: number, durationMilliseconds: number): AudioSegment => ({
  sequence,
  status: "ready",
  durationMilliseconds,
  url: `https://example.com/segments/${sequence}/audio.mp3`,
});
// The second segment failed, so it takes no time on the timeline.
const TIMELINE = createAudiobookTimeline([
  ready(0, 20_000),
  { sequence: 1, status: "failed", explanation: "Rejected" },
  ready(2, 10_000),
  ready(3, 5_000),
]);

test("segments without audio take no time on the timeline", () => {
  expect(TIMELINE.durationMilliseconds).toBe(35_000);
  expect(TIMELINE.entries.map((entry) => [entry.unitIndex, entry.startMilliseconds])).toEqual([
    [0, 0],
    [2, 20_000],
    [3, 30_000],
  ]);
});

test("a position resolves to its segment and the offset within it", () => {
  expect(locateTimelinePosition(TIMELINE, 0)).toEqual({ entryIndex: 0, offsetMilliseconds: 0 });
  expect(locateTimelinePosition(TIMELINE, 19_999)).toEqual({
    entryIndex: 0,
    offsetMilliseconds: 19_999,
  });
  // A boundary belongs to the segment that starts there.
  expect(locateTimelinePosition(TIMELINE, 20_000)).toEqual({
    entryIndex: 1,
    offsetMilliseconds: 0,
  });
  expect(locateTimelinePosition(TIMELINE, 27_500)).toEqual({
    entryIndex: 1,
    offsetMilliseconds: 7_500,
  });
});

test("a position outside the audiobook is clamped to a playable one", () => {
  expect(locateTimelinePosition(TIMELINE, -5)).toEqual({ entryIndex: 0, offsetMilliseconds: 0 });
  expect(locateTimelinePosition(TIMELINE, 99_000)).toEqual({
    entryIndex: 2,
    offsetMilliseconds: 4_999,
  });
  expect(locateTimelinePosition(createAudiobookTimeline([]), 0)).toBeUndefined();
});

test("a unit without audio resolves to the next unit that has some", () => {
  expect(findTimelineEntryIndex(TIMELINE, 0)).toBe(0);
  expect(findTimelineEntryIndex(TIMELINE, 1)).toBe(1);
  expect(findTimelineEntryIndex(TIMELINE, 3)).toBe(2);
  expect(findTimelineEntryIndex(TIMELINE, 4)).toBe(-1);
});
