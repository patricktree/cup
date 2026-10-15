import { expect, test } from "@playwright/test";

import type { PlaybackPosition } from "@cup/listener-api.routes";

import {
  PlaybackSession,
  SAVE_INTERVAL_MILLISECONDS,
  type PlayableAudiobook,
  type PlaybackSessionServices,
} from "#src/app/player/playback-session.ts";

const ready = (sequence: number, durationMilliseconds: number) => ({
  sequence,
  status: "ready" as const,
  durationMilliseconds,
  url: `https://example.com/segments/${sequence}/audio.mp3`,
});
const failed = (sequence: number) => ({
  sequence,
  status: "failed" as const,
  explanation: "Rejected",
});

// The second segment failed, so the third starts where the first ends.
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
  segments: [ready(0, 20_000), failed(1), ready(2, 10_000), failed(3)],
};

function createSession({
  position = null,
  subject = "listener",
  account = { subject: "listener", accessToken: "token-1" },
}: {
  position?: PlaybackPosition | null;
  subject?: string | null;
  account?: { subject: string; accessToken: string } | null;
} = {}) {
  const calls: string[] = [];
  const saved: Array<{ position: PlaybackPosition; subject: string | null }> = [];
  const pendingCookies: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  const state = { now: 0, shouldHoldCookies: false };

  const services: PlaybackSessionServices = {
    getAccount: () => {
      calls.push("getAccount");
      return Promise.resolve(account);
    },
    issueMediaCookie: () => {
      calls.push("issueMediaCookie");
      if (!state.shouldHoldCookies) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        pendingCookies.push({ resolve, reject });
      });
    },
    savePosition: (value, savedSubject) => {
      saved.push({ position: value, subject: savedSubject });
      return Promise.resolve();
    },
    now: () => state.now,
  };
  const session = new PlaybackSession(
    { conversionId: "conversion", audiobook: AUDIOBOOK, position, subject },
    services,
  );

  return { session, calls, saved, pendingCookies, state };
}

const countCookies = (calls: string[]) =>
  calls.filter((call) => call === "issueMediaCookie").length;

test("restores the saved unit and offset", () => {
  const { session } = createSession({
    position: { synchronizationUnitId: "unit-3", offsetMilliseconds: 4_000 },
  });

  expect(session.initialLocation).toEqual({ entryIndex: 1, offsetMilliseconds: 4_000 });
  expect(session.reportedPositionAt(session.initialLocation)).toEqual({
    currentUnitIndex: 2,
    positionMilliseconds: 24_000,
  });
});

test("a restored unit without audio resumes at the start of the next unit with audio", () => {
  const { session } = createSession({
    position: { synchronizationUnitId: "unit-2", offsetMilliseconds: 4_000 },
  });

  expect(session.initialLocation).toEqual({ entryIndex: 1, offsetMilliseconds: 0 });
});

test("an unknown position, or one after the last audio, restores the start", () => {
  for (const position of [
    null,
    { synchronizationUnitId: "removed-unit", offsetMilliseconds: 4_000 },
    { synchronizationUnitId: "unit-4", offsetMilliseconds: 4_000 },
  ]) {
    expect(createSession({ position }).session.initialLocation).toEqual({
      entryIndex: 0,
      offsetMilliseconds: 0,
    });
  }
});

test("a reported position becomes the unit and the offset within its audio", () => {
  const { session } = createSession();

  expect(
    session.listeningPositionOf({ currentUnitIndex: 2, positionMilliseconds: 27_500 }),
  ).toEqual({ synchronizationUnitId: "unit-3", offsetMilliseconds: 7_500 });
  expect(session.listeningPositionOf({ currentUnitIndex: 0, positionMilliseconds: 0 })).toEqual({
    synchronizationUnitId: "unit-1",
    offsetMilliseconds: 0,
  });
});

test("the position reported for a restored location restores it again", () => {
  const position = { synchronizationUnitId: "unit-3", offsetMilliseconds: 4_000 };
  const { session } = createSession({ position });

  expect(session.listeningPositionOf(session.reportedPositionAt(session.initialLocation))).toEqual(
    position,
  );
});

test("skipping moves between units with audio", () => {
  const { session } = createSession();

  expect(session.adjacentUnitIndex(0, 1)).toBe(2);
  expect(session.adjacentUnitIndex(2, -1)).toBe(0);
  expect(session.adjacentUnitIndex(2, 1)).toBeUndefined();
  expect(session.adjacentUnitIndex(1, 1)).toBeUndefined();
});

test("media authorization checks the subject before issuing the cookie", async () => {
  const { session, calls } = createSession();

  await session.authorizeMedia();

  expect(calls).toEqual(["getAccount", "issueMediaCookie"]);
});

test("concurrent media authorizations share one cookie", async () => {
  const { session, calls, pendingCookies, state } = createSession();
  state.shouldHoldCookies = true;

  // As when loading and playing in one gesture: the engine, the host, then Play.
  const requests = [session.authorizeMedia(), session.authorizeMedia(), session.authorizeMedia()];
  await expect.poll(() => pendingCookies.length).toBe(1);
  pendingCookies[0]?.resolve();
  await Promise.all(requests);

  expect(countCookies(calls)).toBe(1);
});

test("each media authorization after the previous one settled issues a new cookie", async () => {
  const { session, calls } = createSession();

  await session.authorizeMedia();
  await session.authorizeMedia();

  expect(countCookies(calls)).toBe(2);
});

test("a failed media authorization does not block the next one", async () => {
  const { session, calls, pendingCookies, state } = createSession();
  state.shouldHoldCookies = true;

  const failing = session.authorizeMedia();
  await expect.poll(() => pendingCookies.length).toBe(1);
  pendingCookies[0]?.reject(new Error("Sign in again to continue playback."));
  await expect(failing).rejects.toThrow("Sign in again to continue playback.");

  state.shouldHoldCookies = false;
  await session.authorizeMedia();
  expect(countCookies(calls)).toBe(2);
});

test("another signed-in user gets neither a cookie nor a token", async () => {
  const { session, calls } = createSession({
    account: { subject: "someone-else", accessToken: "token-2" },
  });

  await expect(session.authorizeMedia()).rejects.toThrow("Sign in again to continue playback.");
  await expect(session.getAccessToken()).rejects.toThrow("Sign in again to continue playback.");
  expect(calls).toEqual(["getAccount", "getAccount"]);
});

test("a signed-out account is refused", async () => {
  const { session, calls } = createSession({ account: null });

  await expect(session.authorizeMedia()).rejects.toThrow("Sign in again to continue playback.");
  expect(calls).toEqual(["getAccount"]);
});

test("the access token is the subject's, without issuing a cookie", async () => {
  const { session, calls } = createSession();

  await expect(session.getAccessToken()).resolves.toBe("token-1");
  expect(calls).toEqual(["getAccount"]);
});

test("anonymous and trial listeners need no media authorization", async () => {
  const { session, calls } = createSession({ subject: null, account: null });

  await session.authorizeMedia();
  await expect(session.getAccessToken()).resolves.toBeNull();
  expect(calls).toEqual([]);
});

test("saves go to the subject's account in order, without their own account lookup", async () => {
  const { session, saved, calls } = createSession();

  void session.save({ currentUnitIndex: 0, positionMilliseconds: 1_000 });
  await session.save({ currentUnitIndex: 2, positionMilliseconds: 21_000 });
  expect(calls).toEqual([]);

  expect(saved).toEqual([
    {
      position: { synchronizationUnitId: "unit-1", offsetMilliseconds: 1_000 },
      subject: "listener",
    },
    {
      position: { synchronizationUnitId: "unit-3", offsetMilliseconds: 1_000 },
      subject: "listener",
    },
  ]);
});

test("saves during playback wait for the save interval", async () => {
  const { session, saved, state } = createSession();
  const reported = { currentUnitIndex: 0, positionMilliseconds: 1_000 };

  await session.saveIfDue(reported);
  state.now = SAVE_INTERVAL_MILLISECONDS - 1;
  await session.saveIfDue(reported);
  expect(saved).toHaveLength(1);

  state.now = SAVE_INTERVAL_MILLISECONDS;
  await session.saveIfDue(reported);
  expect(saved).toHaveLength(2);
});

test("an anonymous listener's position stays on this device", async () => {
  const { session, saved, calls } = createSession({ subject: null, account: null });

  await session.save({ currentUnitIndex: 0, positionMilliseconds: 1_000 });

  expect(saved).toEqual([
    {
      position: { synchronizationUnitId: "unit-1", offsetMilliseconds: 1_000 },
      subject: null,
    },
  ]);
  expect(calls).toEqual([]);
});
