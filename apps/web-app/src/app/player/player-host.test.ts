import { expect, test } from "@playwright/test";

import type { PlaybackPosition } from "@cup/web-app-api.routes";

import type { PlayableAudiobook, PlayerSnapshot } from "#src/app/player/audiobook-player.ts";
import { PlayerHost, type LoadRequest } from "#src/app/player/player-host.ts";
import type { Player } from "#src/platform/player.ts";

type FakePlayer = Player & {
  calls: string[];
  position: PlaybackPosition | null;
  setSnapshot(value: Partial<PlayerSnapshot>): void;
};

function createFakePlayer(position: PlaybackPosition | null): FakePlayer {
  const calls: string[] = [];
  let snapshot: PlayerSnapshot = {
    currentUnitIndex: 0,
    positionMilliseconds: 0,
    durationMilliseconds: 15_000,
    isPlaying: false,
    isBuffering: false,
    error: null,
  };
  const record = (call: string) => () => {
    calls.push(call);
  };

  return {
    calls,
    position,
    setSnapshot: (value) => {
      snapshot = { ...snapshot, ...value };
    },
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    open: record("open"),
    close: record("close"),
    play: record("play"),
    pause: record("pause"),
    seekToUnit: (unitIndex) => calls.push(`seekToUnit:${unitIndex}`),
    seekTo: (positionMilliseconds) => calls.push(`seekTo:${positionMilliseconds}`),
    skip: (direction) => calls.push(`skip:${direction}`),
  };
}

function createHost({ authorize = () => Promise.resolve() } = {}) {
  const players: FakePlayer[] = [];
  const mediaSessions: string[] = [];
  const host = new PlayerHost({
    createPlayer: (_conversionId, _audiobook, position) => {
      const player = createFakePlayer(position);
      players.push(player);
      return player;
    },
    registerMediaSession: (_player, title) => {
      mediaSessions.push(`register:${title}`);
      return () => mediaSessions.push(`unregister:${title}`);
    },
    authorize,
  });

  return { host, players, mediaSessions };
}

const ready = (sequence: number) => ({
  sequence,
  status: "ready" as const,
  durationMilliseconds: 5_000,
  url: `https://example.com/segments/${sequence}/audio.mp3`,
});

function createAudiobook(
  title: string,
  segments: PlayableAudiobook["segments"],
): PlayableAudiobook {
  return {
    status: "ready",
    canGenerate: true,
    playbackPosition: null,
    title,
    originalUrl: "https://source.example.test/fixture",
    narrationDocument: {
      html: "<article></article>",
      synchronizationUnits: [
        { id: "unit-1", narrationText: "One" },
        { id: "unit-2", narrationText: "Two" },
        { id: "unit-3", narrationText: "Three" },
      ],
    },
    segments,
  };
}

function createRequest(conversionId: string, audiobook: PlayableAudiobook): LoadRequest {
  return { conversionId, audiobook, position: null, subject: null, hasPlaybackConsent: true };
}

const FIRST = createAudiobook("First", [ready(0), ready(1), ready(2)]);
const SECOND = createAudiobook("Second", [ready(0), ready(1), ready(2)]);

test("loading opens the player without starting playback", () => {
  const { host, players, mediaSessions } = createHost();

  host.load(createRequest("first", FIRST));

  expect(players[0]?.calls).toEqual(["open"]);
  expect(host.getSnapshot().loaded?.conversionId).toBe("first");
  expect(mediaSessions).toEqual(["register:First"]);
});

test("loading another audiobook pauses and closes the previous player", () => {
  const { host, players, mediaSessions } = createHost();

  host.load(createRequest("first", FIRST));
  host.loadAndPlay(createRequest("second", SECOND), 2);

  expect(players[0]?.calls).toEqual(["open", "pause", "close"]);
  expect(players[1]?.calls).toEqual(["open", "seekToUnit:2", "play"]);
  expect(host.getSnapshot().loaded?.conversionId).toBe("second");
  expect(mediaSessions).toEqual(["register:First", "unregister:First", "register:Second"]);
});

test("playback needs consent when segments failed", () => {
  const { host, players } = createHost();
  const audiobook = createAudiobook("Partial", [
    ready(0),
    { sequence: 1, status: "failed", explanation: "Rejected" },
    ready(2),
  ]);

  host.load({ ...createRequest("partial", audiobook), hasPlaybackConsent: false });
  host.play();
  expect(players[0]?.calls).toEqual(["open"]);

  host.consentToSkippingSegmentsWithoutAudio();
  host.play();
  expect(players[0]?.calls).toEqual(["open", "play"]);
});

test("a newer audiobook version continues at the current position", () => {
  const { host, players } = createHost();
  const partial = createAudiobook("Partial", [
    ready(0),
    { sequence: 1, status: "failed", explanation: "Rejected" },
    ready(2),
  ]);

  host.load({ ...createRequest("partial", partial), hasPlaybackConsent: false });
  // Two seconds into the third unit, which follows one five-second segment with audio.
  players[0]?.setSnapshot({ currentUnitIndex: 2, positionMilliseconds: 7_000 });
  host.replaceAudiobook(createAudiobook("Partial", [ready(0), ready(1), ready(2)]));

  expect(players[0]?.calls).toEqual(["open", "pause", "close"]);
  expect(players[1]?.position).toEqual({
    synchronizationUnitId: "unit-3",
    offsetMilliseconds: 2_000,
  });
  expect(
    host.getSnapshot().loaded?.audiobook.segments.every((segment) => segment.status === "ready"),
  ).toBe(true);
  // Every segment now has audio, so playing no longer skips anything that needs consent.
  host.play();
  expect(players[1]?.calls).toEqual(["open", "play"]);
});

test("a newer version that still lacks audio keeps asking for consent", () => {
  const { host, players } = createHost();
  const failed = { sequence: 1, status: "failed" as const, explanation: "Rejected" };

  host.load({
    ...createRequest("partial", createAudiobook("Partial", [ready(0), failed, failed])),
    hasPlaybackConsent: false,
  });
  host.replaceAudiobook(createAudiobook("Partial", [ready(0), failed, ready(2)]));
  host.play();

  expect(players[1]?.calls).toEqual(["open"]);
  expect(host.getSnapshot().loaded?.hasPlaybackConsent).toBe(false);
});

test("a playing audiobook is never replaced", () => {
  const { host, players } = createHost();

  host.load(createRequest("first", FIRST));
  players[0]?.setSnapshot({ isPlaying: true });

  expect(() => host.replaceAudiobook(FIRST)).toThrow();
  expect(players).toHaveLength(1);
});

test("unloading closes the player and empties the host", () => {
  const { host, players, mediaSessions } = createHost();

  host.load(createRequest("first", FIRST));
  host.unload();

  expect(players[0]?.calls).toEqual(["open", "pause", "close"]);
  expect(host.getSnapshot().loaded).toBeNull();
  expect(mediaSessions).toEqual(["register:First", "unregister:First"]);
});

test("a failed authorization pauses playback and is reported", async () => {
  const { host, players } = createHost({
    authorize: () => Promise.reject(new Error("Sign in again to continue playback.")),
  });

  host.load(createRequest("first", FIRST));
  host.play();

  await expect
    .poll(() => host.getSnapshot().authorizationError)
    .toBe("Sign in again to continue playback.");
  expect(players[0]?.calls).toEqual(["open", "play", "pause"]);
});
