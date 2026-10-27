import { expect, test } from "@playwright/test";

import type { PlaybackPosition } from "@cup/listener-api.routes";

import {
  PlaybackSession,
  SAVE_INTERVAL_MILLISECONDS,
  type PlayableAudiobook,
  type PlaybackSessionServices,
} from "#src/app/player/playback-session.ts";

/** The session ignores a ready segment's own audio; only the narration track plays. */
const ready = (sequence: number) => ({
  sequence,
  status: "ready" as const,
  durationMilliseconds: 5_000,
  url: `https://example.com/segments/${sequence}/audio.mp3`,
});

// Units of 20, 10, 3 and 2 seconds on the narration track.
const AUDIOBOOK: PlayableAudiobook = {
  status: "ready",
  canGenerate: true,
  playbackPosition: null,
  title: "Fixture",
  originalUrl: "https://source.example.test/fixture",
  narrationDocument: {
    html: "<article></article>",
    synchronizationUnits: [
      { id: "unit-1", narrationText: "One" },
      { id: "unit-2", narrationText: "Two" },
      { id: "unit-3", narrationText: "Three" },
      { id: "unit-4", narrationText: "Four" },
    ],
  },
  segments: [ready(0), ready(1), ready(2), ready(3)],
  narrationTrack: {
    url: "https://example.com/narration-track.mp3?token=fixture",
    durationMilliseconds: 35_000,
    startMilliseconds: [0, 20_000, 30_000, 33_000],
  },
};

function createSession({
  position = null,
  subject = "listener",
  savePosition,
}: {
  position?: PlaybackPosition | null;
  subject?: string | null;
  savePosition?: PlaybackSessionServices["savePosition"];
} = {}) {
  const saved: Array<{ position: PlaybackPosition; subject: string | null }> = [];
  const state = { now: 0 };

  const services: PlaybackSessionServices = {
    savePosition:
      savePosition ??
      ((value, savedSubject) => {
        saved.push({ position: value, subject: savedSubject });
        return Promise.resolve();
      }),
    now: () => state.now,
  };
  const session = new PlaybackSession(
    { conversionId: "conversion", audiobook: AUDIOBOOK, position, subject },
    services,
  );

  return { session, saved, state };
}

test("restores the saved unit and offset as a position on the narration track", () => {
  const { session } = createSession({
    position: { synchronizationUnitId: "unit-2", offsetMilliseconds: 4_000 },
  });

  expect(session.initialPositionMilliseconds).toBe(24_000);
});

test("an unknown unit, or no saved position, restores the start", () => {
  for (const position of [
    null,
    { synchronizationUnitId: "removed-unit", offsetMilliseconds: 4_000 },
  ]) {
    expect(createSession({ position }).session.initialPositionMilliseconds).toBe(0);
  }
});

test("a position on the narration track becomes the unit and the offset within its audio", () => {
  const { session } = createSession();

  expect(session.listeningPositionAt(27_500)).toEqual({
    synchronizationUnitId: "unit-2",
    offsetMilliseconds: 7_500,
  });
  expect(session.listeningPositionAt(0)).toEqual({
    synchronizationUnitId: "unit-1",
    offsetMilliseconds: 0,
  });
  expect(session.listeningPositionAt(34_000)).toEqual({
    synchronizationUnitId: "unit-4",
    offsetMilliseconds: 1_000,
  });
});

test("a restored position converts back to the saved listening position", () => {
  const position = { synchronizationUnitId: "unit-3", offsetMilliseconds: 1_500 };
  const { session } = createSession({ position });

  expect(session.listeningPositionAt(session.initialPositionMilliseconds)).toEqual(position);
});

test("a narration track whose start offsets do not match the units is refused", () => {
  expect(
    () =>
      new PlaybackSession(
        {
          conversionId: "conversion",
          audiobook: {
            ...AUDIOBOOK,
            narrationTrack: { ...AUDIOBOOK.narrationTrack, startMilliseconds: [0, 20_000] },
          },
          position: null,
          subject: null,
        },
        { savePosition: () => Promise.resolve(), now: () => 0 },
      ),
  ).toThrow("2 start offsets for 4 synchronization units");
});

test("saves go to the subject in order", async () => {
  const { session, saved } = createSession();

  void session.save(1_000);
  await session.save(21_000);

  expect(saved).toEqual([
    {
      position: { synchronizationUnitId: "unit-1", offsetMilliseconds: 1_000 },
      subject: "listener",
    },
    {
      position: { synchronizationUnitId: "unit-2", offsetMilliseconds: 1_000 },
      subject: "listener",
    },
  ]);
});

test("a refused save does not hold back the next one", async () => {
  const saved: string[] = [];
  let shouldRefuse = true;
  const { session } = createSession({
    savePosition: (position) => {
      if (shouldRefuse) {
        shouldRefuse = false;
        return Promise.reject(new Error("Sign in again to continue playback."));
      }
      saved.push(position.synchronizationUnitId);
      return Promise.resolve();
    },
  });

  await expect(session.save(1_000)).rejects.toThrow("Sign in again to continue playback.");
  await session.save(21_000);

  expect(saved).toEqual(["unit-2"]);
});

test("saves during playback wait for the save interval", async () => {
  const { session, saved, state } = createSession();

  await session.saveIfDue(1_000);
  state.now = SAVE_INTERVAL_MILLISECONDS - 1;
  await session.saveIfDue(2_000);
  expect(saved).toHaveLength(1);

  state.now = SAVE_INTERVAL_MILLISECONDS;
  await session.saveIfDue(3_000);
  expect(saved).toHaveLength(2);
});

test("an anonymous listener's position is saved without a subject", async () => {
  const { session, saved } = createSession({ subject: null });

  await session.save(1_000);

  expect(saved).toEqual([
    {
      position: { synchronizationUnitId: "unit-1", offsetMilliseconds: 1_000 },
      subject: null,
    },
  ]);
});
