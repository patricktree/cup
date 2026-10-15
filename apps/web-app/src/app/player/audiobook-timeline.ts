import type { AudioSegment } from "@cup/web-app-api.routes";

/** One audio segment's interval on the whole-audiobook timeline. */
type TimelineEntry = {
  unitIndex: number;
  startMilliseconds: number;
  durationMilliseconds: number;
  url: string;
};

/**
 * The whole-audiobook timeline derived from its independently stored audio segments.
 *
 * Segments without audio are skipped: they take no time, so the total duration stays exact.
 */
export type AudiobookTimeline = {
  entries: TimelineEntry[];
  durationMilliseconds: number;
};

export function createAudiobookTimeline(segments: readonly AudioSegment[]): AudiobookTimeline {
  const entries: TimelineEntry[] = [];
  let durationMilliseconds = 0;

  for (const segment of [...segments].sort((left, right) => left.sequence - right.sequence)) {
    if (segment.status !== "ready") {
      continue;
    }

    entries.push({
      unitIndex: segment.sequence,
      startMilliseconds: durationMilliseconds,
      durationMilliseconds: segment.durationMilliseconds,
      url: segment.url,
    });
    durationMilliseconds += segment.durationMilliseconds;
  }

  return { entries, durationMilliseconds };
}

/** Finds the entry playing at a whole-audiobook position and the offset within its audio. */
export function locateTimelinePosition(
  timeline: AudiobookTimeline,
  positionMilliseconds: number,
): { entryIndex: number; offsetMilliseconds: number } | undefined {
  if (timeline.entries.length === 0) {
    return undefined;
  }

  // Stop just short of the end: an element sought to its end has ended and would not resume there.
  const position = Math.min(
    Math.max(0, positionMilliseconds),
    Math.max(0, timeline.durationMilliseconds - 1),
  );
  // The last entry starting at or before the position; entries are ordered by start.
  const followingEntryIndex = timeline.entries.findIndex(
    (entry) => entry.startMilliseconds > position,
  );
  const entryIndex =
    followingEntryIndex < 0 ? timeline.entries.length - 1 : Math.max(0, followingEntryIndex - 1);
  const entry = timeline.entries[entryIndex]!;

  return {
    entryIndex,
    offsetMilliseconds: Math.min(position - entry.startMilliseconds, entry.durationMilliseconds),
  };
}

/** Finds the entry for a unit, or the next one with audio when that unit was skipped. */
export function findTimelineEntryIndex(timeline: AudiobookTimeline, unitIndex: number): number {
  return timeline.entries.findIndex((entry) => entry.unitIndex >= unitIndex);
}
