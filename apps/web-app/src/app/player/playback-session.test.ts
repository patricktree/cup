import type { PlaybackPosition } from "@cup/listener-api.routes";

import {
  PlaybackSession,
  SAVE_INTERVAL_MILLISECONDS,
  SAVE_RETRY_DELAY_MILLISECONDS,
  SAVE_RETRY_FAILURE_MESSAGE,
  type PlayableAudiobook,
  type PlaybackSessionServices,
} from "#src/app/player/playback-session.ts";
import { UserFacingError } from "#src/errors.ts";
import { expect, test } from "#src/test-utils/component-test.ts";

/** The session ignores a ready segment's own audio; only the narration track plays. */
const ready = (sequence: number) => ({
  sequence,
  status: "ready" as const,
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
  /** The armed retry timer and reconnect listener; tests fire them in place of the browser. */
  const retry: {
    timer: (() => void) | null;
    delay: number | null;
    reconnect: (() => void) | null;
  } = { timer: null, delay: null, reconnect: null };

  const services: PlaybackSessionServices = {
    savePosition:
      savePosition ??
      ((value, savedSubject) => {
        saved.push({ position: value, subject: savedSubject });
        return Promise.resolve();
      }),
    now: () => state.now,
    setRetryTimer: (callback, delayMilliseconds) => {
      retry.timer = callback;
      retry.delay = delayMilliseconds;
      return () => {
        retry.timer = null;
        retry.delay = null;
      };
    },
    onReconnect: (callback) => {
      retry.reconnect = callback;
      return () => {
        retry.reconnect = null;
      };
    },
  };
  const session = new PlaybackSession(
    { conversionId: "conversion", audiobook: AUDIOBOOK, position, subject },
    services,
  );

  return { session, saved, state, retry };
}

/** Lets settled saves run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const NOT_CONNECTED = new TypeError(
  'Unable to resolve host "cup.audio": No address associated with hostname',
);

/** A save service that fails while `isConnected` is false, as a lost connection does. */
function createFlakyConnection() {
  const connection = { isConnected: false };
  const saved: string[] = [];
  const savePosition: PlaybackSessionServices["savePosition"] = (position) => {
    if (!connection.isConnected) {
      return Promise.reject(NOT_CONNECTED);
    }
    saved.push(`${position.synchronizationUnitId}+${position.offsetMilliseconds}`);
    return Promise.resolve();
  };
  return { connection, saved, savePosition };
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
        {
          savePosition: () => Promise.resolve(),
          now: () => 0,
          setRetryTimer: () => () => undefined,
          onReconnect: () => () => undefined,
        },
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

test("a refused save is reported in its own words, not retried, and does not hold back the next one", async () => {
  const saved: string[] = [];
  let shouldRefuse = true;
  const { session, retry } = createSession({
    savePosition: (position) => {
      if (shouldRefuse) {
        shouldRefuse = false;
        return Promise.reject(new UserFacingError({ title: "Sign in to continue." }));
      }
      saved.push(position.synchronizationUnitId);
      return Promise.resolve();
    },
  });

  await session.save(1_000);
  expect(session.getSaveFailure()).toBe("Sign in to continue.");
  expect(retry.timer).toBeNull();

  await session.save(21_000);
  expect(saved).toEqual(["unit-2"]);
  expect(session.getSaveFailure()).toBeNull();
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

test("a save that fails for a lost connection is retried after the retry delay", async () => {
  const { connection, saved, savePosition } = createFlakyConnection();
  const { session, retry } = createSession({ savePosition });

  await session.save(1_000);
  expect(retry.delay).toBe(SAVE_RETRY_DELAY_MILLISECONDS);

  connection.isConnected = true;
  retry.timer?.();
  await settle();

  expect(saved).toEqual(["unit-1+1000"]);
  expect(retry.timer).toBeNull();
});

test("a failed save is retried when the connection may be back", async () => {
  const { connection, saved, savePosition } = createFlakyConnection();
  const { session, retry } = createSession({ savePosition });

  await session.save(1_000);
  connection.isConnected = true;
  retry.reconnect?.();
  await settle();

  expect(saved).toEqual(["unit-1+1000"]);
  expect(retry.reconnect).toBeNull();
});

test("a newer save replaces the retry of a failed one", async () => {
  const { connection, saved, savePosition } = createFlakyConnection();
  const { session, retry } = createSession({ savePosition });

  await session.save(1_000);
  connection.isConnected = true;
  await session.save(21_000);

  expect(saved).toEqual(["unit-2+1000"]);
  expect(retry.timer).toBeNull();
  expect(retry.reconnect).toBeNull();
});

test("a lost connection shows nothing when the retry succeeds", async () => {
  const { connection, savePosition } = createFlakyConnection();
  const { session, retry } = createSession({ savePosition });
  const reported: Array<string | null> = [];
  session.subscribeSaveFailure(() => reported.push(session.getSaveFailure()));

  await session.save(1_000);
  connection.isConnected = true;
  retry.timer?.();
  await settle();

  expect(reported).toEqual([]);
  expect(session.getSaveFailure()).toBeNull();
});

test("a failed retry shows plain words, never the error's own text, until a save succeeds", async () => {
  const { connection, savePosition } = createFlakyConnection();
  const { session, retry } = createSession({ savePosition });
  const reported: Array<string | null> = [];
  session.subscribeSaveFailure(() => reported.push(session.getSaveFailure()));

  await session.save(1_000);
  retry.timer?.();
  await settle();
  expect(session.getSaveFailure()).toBe(SAVE_RETRY_FAILURE_MESSAGE);
  expect(retry.timer).not.toBeNull();

  connection.isConnected = true;
  retry.timer?.();
  await settle();

  expect(reported).toEqual([SAVE_RETRY_FAILURE_MESSAGE, null]);
});

test("closing the session stops retrying a failed save", async () => {
  const { savePosition } = createFlakyConnection();
  const { session, retry } = createSession({ savePosition });

  await session.save(1_000);
  session.close();

  expect(retry.timer).toBeNull();
  expect(retry.reconnect).toBeNull();
});

test("saves during playback that keep failing for the retry delay show plain words", async () => {
  const { savePosition } = createFlakyConnection();
  const { session, state } = createSession({ savePosition });

  await session.saveIfDue(1_000);
  state.now = SAVE_RETRY_DELAY_MILLISECONDS - SAVE_INTERVAL_MILLISECONDS;
  await session.saveIfDue(2_000);
  expect(session.getSaveFailure()).toBeNull();

  state.now = SAVE_RETRY_DELAY_MILLISECONDS;
  await session.saveIfDue(3_000);
  expect(session.getSaveFailure()).toBe(SAVE_RETRY_FAILURE_MESSAGE);
});
