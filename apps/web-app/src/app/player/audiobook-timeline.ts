import type { NarrationTrack } from "@cup/listener-api.routes";

/**
 * The whole-audiobook timeline: the narration track's duration and where each synchronization
 * unit's audio starts in it. Every unit has an entry, in document order.
 */
export type AudiobookTimeline = Pick<NarrationTrack, "startMilliseconds" | "durationMilliseconds">;

/** The unit playing at a position: the last one that starts at or before it. */
export function findUnitIndexAt(timeline: AudiobookTimeline, positionMilliseconds: number) {
  // Positions update several times a second, so search the ordered starts instead of scanning them.
  let low = 0;
  let high = timeline.startMilliseconds.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (timeline.startMilliseconds[middle]! <= positionMilliseconds) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return low;
}

/**
 * Clamps a position to the narration track. It stops just short of the end: an element sought to
 * its end has ended, and Play would restart it from the beginning.
 */
export function clampToTimeline(timeline: AudiobookTimeline, positionMilliseconds: number) {
  return Math.min(
    Math.max(0, positionMilliseconds),
    Math.max(0, timeline.durationMilliseconds - 1),
  );
}
