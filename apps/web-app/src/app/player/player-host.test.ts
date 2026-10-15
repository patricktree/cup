import { expect, test } from "@playwright/test";

import type { PlaybackPosition } from "@cup/web-app-api.routes";

import {
  PlaybackSession,
  type PlayableAudiobook,
  type PlaybackSessionRequest,
  type PlaybackSessionServices,
  type PreparedAudiobook,
} from "#src/app/player/playback-session.ts";
import { PlayerHost, type PlayerHostAccount } from "#src/app/player/player-host.ts";
import type { Player, PlayerSnapshot } from "#src/platform/player.ts";

type FakePlayer = Player & {
  calls: string[];
  conversionId: string;
  audiobook: PlayableAudiobook;
  position: PlaybackPosition | null;
  subject: string | null;
  /** Changes the snapshot and notifies subscribers, like a real engine reporting progress. */
  setSnapshot(value: Partial<PlayerSnapshot>): void;
};

type FakePlayerOptions = Pick<FakePlayer, "conversionId" | "audiobook" | "position" | "subject">;

function createFakePlayer(options: FakePlayerOptions): FakePlayer {
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  let snapshot: PlayerSnapshot = {
    currentUnitIndex: 0,
    positionMilliseconds: 0,
    durationMilliseconds: 15_000,
    isPlaying: false,
    isBuffering: false,
    error: null,
  };
  const setSnapshot = (value: Partial<PlayerSnapshot>) => {
    snapshot = { ...snapshot, ...value };
    for (const listener of listeners) listener();
  };

  return {
    ...options,
    calls,
    setSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    open: () => calls.push("open"),
    close: () => calls.push("close"),
    play: () => {
      calls.push("play");
      setSnapshot({ isPlaying: true });
    },
    pause: () => {
      calls.push("pause");
      setSnapshot({ isPlaying: false });
    },
    seekToUnit: (unitIndex) => calls.push(`seekToUnit:${unitIndex}`),
    seekTo: (positionMilliseconds) => calls.push(`seekTo:${positionMilliseconds}`),
    skip: (direction) => calls.push(`skip:${direction}`),
  };
}

function createHost({
  issueMediaCookie = (): Promise<void> => Promise.resolve(),
  localPositions = new Map<string, PlaybackPosition>(),
  subject = null as string | null,
} = {}) {
  const players: FakePlayer[] = [];
  const mediaSessions: string[] = [];
  let account: PlayerHostAccount = { status: "known", subject };
  const sessionServices: PlaybackSessionServices = {
    getAccount: () => {
      const signedIn = account.status === "known" ? account.subject : null;
      return Promise.resolve(
        signedIn === null ? null : { subject: signedIn, accessToken: "token" },
      );
    },
    issueMediaCookie,
    savePosition: () => Promise.resolve(),
    now: () => 0,
  };
  // The fake players record what the host asked to load, before the session resolves it.
  const requests = new WeakMap<PlaybackSession, PlaybackSessionRequest>();
  const host = new PlayerHost({
    createSession: (request) => {
      const session = new PlaybackSession(request, sessionServices);
      requests.set(session, request);
      return session;
    },
    createPlayer: (session) => {
      const request = requests.get(session);
      if (!request) throw new Error("The session was not created by this host.");
      const player = createFakePlayer({
        conversionId: request.conversionId,
        audiobook: request.audiobook,
        position: request.position,
        subject: request.subject,
      });
      players.push(player);
      return player;
    },
    registerMediaSession: (_player, title) => {
      mediaSessions.push(`register:${title}`);
      return () => mediaSessions.push(`unregister:${title}`);
    },
    getAccount: () => account,
    getLocalPosition: (conversionId) => localPositions.get(conversionId) ?? null,
  });
  host.accountChanged();
  /** Changes the account and reports it, like the provider does after a render. */
  const setAccount = (value: PlayerHostAccount) => {
    account = value;
    host.accountChanged();
  };
  /** Changes the account without reporting it, like the store does before the provider re-renders. */
  const changeAccountSilently = (value: PlayerHostAccount) => {
    account = value;
  };

  return { host, players, mediaSessions, setAccount, changeAccountSilently };
}

const ready = (sequence: number) => ({
  sequence,
  status: "ready" as const,
  durationMilliseconds: 5_000,
  url: `https://example.com/segments/${sequence}/audio.mp3`,
});
const failed = (sequence: number) => ({
  sequence,
  status: "failed" as const,
  explanation: "Rejected",
});

function createAudiobook(
  title: string,
  segments: PlayableAudiobook["segments"],
  playbackPosition: PlaybackPosition | null = null,
): PlayableAudiobook {
  return {
    status: "ready",
    canGenerate: true,
    playbackPosition,
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

function createSynthesizingAudiobook(title: string): PreparedAudiobook {
  return {
    ...createAudiobook(title, []),
    status: "synthesizing",
    segments: [
      ready(0),
      { sequence: 1, status: "generating" },
      { sequence: 2, status: "generating" },
    ],
  };
}

const FIRST = createAudiobook("First", [ready(0), ready(1), ready(2)]);
const SECOND = createAudiobook("Second", [ready(0), ready(1), ready(2)]);
const PARTIAL = createAudiobook("Partial", [ready(0), failed(1), ready(2)]);
const COMPLETE = createAudiobook("Partial", [ready(0), ready(1), ready(2)]);

test("showing an audiobook loads it into the empty player without starting playback", () => {
  const { host, players, mediaSessions } = createHost();

  host.showConversion("first", FIRST);

  expect(players).toHaveLength(1);
  expect(players[0]?.calls).toEqual(["open"]);
  expect(host.getSnapshot().loaded?.conversionId).toBe("first");
  expect(host.getSnapshot().shown?.canPlay).toBe(true);
  expect(mediaSessions).toEqual(["register:First"]);
});

test("showing another audiobook keeps the loaded one until it is played", () => {
  const { host, players, mediaSessions } = createHost();

  host.showConversion("first", FIRST);
  host.play();
  host.hideConversion("first");
  host.showConversion("second", SECOND);
  expect(players).toHaveLength(1);
  expect(players[0]?.calls).toEqual(["open", "play"]);

  host.playShown(2);

  expect(players[0]?.calls).toEqual(["open", "play", "pause", "close"]);
  expect(players[1]?.calls).toEqual(["open", "seekToUnit:2", "play"]);
  expect(host.getSnapshot().loaded?.conversionId).toBe("second");
  expect(mediaSessions).toEqual(["register:First", "unregister:First", "register:Second"]);
});

test("an audiobook is loaded once it becomes ready while shown", () => {
  const { host, players } = createHost();

  host.showConversion("first", createSynthesizingAudiobook("First"));
  expect(players).toHaveLength(0);
  expect(host.getSnapshot().shown?.canPlay).toBe(false);
  host.playShown();
  expect(players).toHaveLength(0);

  host.showConversion("first", FIRST);
  expect(players).toHaveLength(1);
  expect(players[0]?.calls).toEqual(["open"]);
});

test("an audiobook without any audio is never loaded", () => {
  const { host, players } = createHost();

  host.showConversion("silent", createAudiobook("Silent", [failed(0), failed(1), failed(2)]));
  host.consentToSkippingSegmentsWithoutAudio();
  host.playShown();

  expect(players).toHaveLength(0);
  expect(host.getSnapshot().shown?.canPlay).toBe(false);
});

test("loading waits until the account is restored and uses its listening position", () => {
  const { host, players, setAccount } = createHost();
  const serverPosition = { synchronizationUnitId: "unit-2", offsetMilliseconds: 1_000 };
  setAccount({ status: "restoring" });

  host.showConversion("first", createAudiobook("First", FIRST.segments, serverPosition));
  expect(players).toHaveLength(0);

  setAccount({ status: "known", subject: "user-1" });
  expect(players[0]?.subject).toBe("user-1");
  expect(players[0]?.position).toEqual(serverPosition);
});

test("listeners without an account resume from the device's listening position", () => {
  const localPosition = { synchronizationUnitId: "unit-3", offsetMilliseconds: 500 };
  const { host, players } = createHost({ localPositions: new Map([["first", localPosition]]) });

  host.showConversion(
    "first",
    createAudiobook("First", FIRST.segments, {
      synchronizationUnitId: "unit-2",
      offsetMilliseconds: 1_000,
    }),
  );

  expect(players[0]?.subject).toBeNull();
  expect(players[0]?.position).toEqual(localPosition);
});

test("playback needs consent when segments failed", () => {
  const { host, players } = createHost();

  host.showConversion("partial", PARTIAL);
  // Loading never starts playback, so it needs no consent.
  expect(players[0]?.calls).toEqual(["open"]);
  expect(host.getSnapshot().shown?.canPlay).toBe(false);
  host.play();
  host.playShown(2);
  expect(players[0]?.calls).toEqual(["open"]);

  host.consentToSkippingSegmentsWithoutAudio();
  expect(host.getSnapshot().shown?.canPlay).toBe(true);
  expect(host.getSnapshot().loaded?.hasPlaybackConsent).toBe(true);
  host.playShown(2);
  expect(players[0]?.calls).toEqual(["open", "seekToUnit:2", "play"]);
});

test("consent given while another audiobook plays applies when the shown one is played", () => {
  const { host, players } = createHost();

  host.showConversion("first", FIRST);
  host.play();
  host.hideConversion("first");
  host.showConversion("partial", PARTIAL);
  host.consentToSkippingSegmentsWithoutAudio();
  expect(host.getSnapshot().loaded?.conversionId).toBe("first");

  host.playShown();
  expect(players[1]?.calls).toEqual(["open", "play"]);
  expect(host.getSnapshot().loaded?.hasPlaybackConsent).toBe(true);
});

test("consent is forgotten once the page stops showing the audiobook", () => {
  const { host } = createHost();

  host.showConversion("first", FIRST);
  host.showConversion("partial", PARTIAL);
  host.consentToSkippingSegmentsWithoutAudio();
  // A newer version of the shown audiobook keeps the consent.
  host.showConversion("partial", { ...PARTIAL });
  expect(host.getSnapshot().shown?.canPlay).toBe(true);

  host.hideConversion("partial");
  host.showConversion("partial", PARTIAL);
  expect(host.getSnapshot().shown?.canPlay).toBe(false);
});

test("a newer version with more audio replaces the loaded one at the current position", () => {
  const { host, players } = createHost();

  host.showConversion("partial", PARTIAL);
  // Two seconds into the third unit, which follows one five-second segment with audio.
  players[0]?.setSnapshot({ currentUnitIndex: 2, positionMilliseconds: 7_000 });
  host.updateLoadedAudiobook("partial", COMPLETE);

  expect(players[0]?.calls).toEqual(["open", "pause", "close"]);
  expect(players[1]?.audiobook).toBe(COMPLETE);
  expect(players[1]?.position).toEqual({
    synchronizationUnitId: "unit-3",
    offsetMilliseconds: 2_000,
  });
  // Every segment now has audio, so playing no longer skips anything that needs consent.
  host.play();
  expect(players[1]?.calls).toEqual(["open", "play"]);
});

test("a newer version waits for playback to pause", () => {
  const { host, players } = createHost();

  host.showConversion("partial", PARTIAL);
  host.consentToSkippingSegmentsWithoutAudio();
  host.play();
  host.hideConversion("partial");
  host.updateLoadedAudiobook("partial", COMPLETE);
  expect(players).toHaveLength(1);

  players[0]?.setSnapshot({ positionMilliseconds: 1_000 });
  expect(players).toHaveLength(1);

  host.pause();
  expect(players).toHaveLength(2);
  expect(players[0]?.calls).toEqual(["open", "play", "pause", "pause", "close"]);
  expect(players[1]?.audiobook).toBe(COMPLETE);
  expect(players[1]?.calls).toEqual(["open"]);
});

test("only a ready version with more audio of the loaded audiobook replaces it", () => {
  const { host, players } = createHost();

  host.showConversion("partial", PARTIAL);
  host.updateLoadedAudiobook("partial", PARTIAL);
  host.updateLoadedAudiobook("partial", { ...createSynthesizingAudiobook("Partial") });
  host.updateLoadedAudiobook("another", COMPLETE);
  expect(players).toHaveLength(1);

  host.updateLoadedAudiobook("partial", COMPLETE);
  expect(players).toHaveLength(2);
});

test("a pending version is dropped when another audiobook is played", () => {
  const { host, players } = createHost();

  host.showConversion("first", createAudiobook("First", [ready(0), failed(1), ready(2)]));
  host.consentToSkippingSegmentsWithoutAudio();
  host.play();
  host.updateLoadedAudiobook("first", FIRST);
  host.hideConversion("first");
  host.showConversion("second", SECOND);
  host.playShown();
  players[1]?.setSnapshot({ isPlaying: false });

  expect(players).toHaveLength(2);
  expect(host.getSnapshot().loaded?.conversionId).toBe("second");
});

test("a newer version that still lacks audio keeps asking for consent", () => {
  const { host, players } = createHost();

  host.showConversion("partial", createAudiobook("Partial", [ready(0), failed(1), failed(2)]));
  host.hideConversion("partial");
  host.updateLoadedAudiobook("partial", PARTIAL);
  host.play();

  expect(players[1]?.calls).toEqual(["open"]);
  expect(host.getSnapshot().loaded?.hasPlaybackConsent).toBe(false);
});

test("a change of the signed-in user unloads the player and reloads the shown audiobook", () => {
  const { host, players, setAccount } = createHost({ subject: "user-1" });

  host.showConversion("first", FIRST);
  host.play();
  setAccount({ status: "restoring" });
  expect(players).toHaveLength(1);
  setAccount({ status: "known", subject: "user-1" });
  expect(players).toHaveLength(1);

  setAccount({ status: "known", subject: null });
  expect(players[0]?.calls).toEqual(["open", "play", "pause", "close"]);
  expect(players[1]?.subject).toBeNull();
  expect(players[1]?.calls).toEqual(["open"]);

  host.hideConversion("first");
  setAccount({ status: "known", subject: "user-2" });
  expect(players).toHaveLength(2);
  expect(host.getSnapshot().loaded).toBeNull();
});

test("the page counts as shown before its audiobook is prepared", () => {
  const { host, players } = createHost();

  host.showConversion("first");
  expect(host.getSnapshot().shown).toMatchObject({ conversionId: "first", canPlay: false });
  expect(players).toHaveLength(0);

  host.showConversion("first", FIRST);
  // The page reporting itself again, for example after a re-render, keeps the audiobook.
  host.showConversion("first");
  expect(host.getSnapshot().shown?.audiobook).toBe(FIRST);
  expect(players).toHaveLength(1);
});

test("another listener has to consent again", () => {
  const { host, setAccount } = createHost({ subject: "user-1" });

  host.showConversion("partial", PARTIAL);
  host.consentToSkippingSegmentsWithoutAudio();
  setAccount({ status: "known", subject: "user-2" });

  expect(host.getSnapshot().loaded?.subject).toBe("user-2");
  expect(host.getSnapshot().loaded?.hasPlaybackConsent).toBe(false);
  expect(host.getSnapshot().shown?.canPlay).toBe(false);
});

test("loading uses the account current at load time, even before the change is reported", () => {
  const { host, players, changeAccountSilently } = createHost({ subject: "user-1" });

  changeAccountSilently({ status: "known", subject: "user-2" });
  host.showConversion("first", FIRST);
  host.accountChanged();

  expect(players).toHaveLength(1);
  expect(players[0]?.subject).toBe("user-2");
});

test("unloading closes the player and empties the host", () => {
  const { host, players, mediaSessions } = createHost();

  host.showConversion("first", FIRST);
  host.unload();

  expect(players[0]?.calls).toEqual(["open", "pause", "close"]);
  expect(host.getSnapshot().loaded).toBeNull();
  expect(mediaSessions).toEqual(["register:First", "unregister:First"]);
});

test("a failed authorization pauses playback and is reported", async () => {
  const { host, players } = createHost({
    subject: "listener",
    issueMediaCookie: () => Promise.reject(new Error("Sign in again to continue playback.")),
  });

  host.showConversion("first", FIRST);
  host.play();

  await expect
    .poll(() => host.getSnapshot().authorizationError)
    .toBe("Sign in again to continue playback.");
  expect(players[0]?.calls).toEqual(["open", "play", "pause"]);
});

/** Lets pending authorizations settle. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("loading and playing in one gesture authorizes once, and each later Play again", async () => {
  let authorizationCount = 0;
  const { host } = createHost({
    subject: "listener",
    issueMediaCookie: () => {
      authorizationCount += 1;
      return Promise.resolve();
    },
  });
  host.showConversion("first", FIRST);
  await settle();
  authorizationCount = 0;

  // Playing another audiobook loads and plays it in one gesture.
  host.showConversion("second", SECOND);
  host.playShown();
  await settle();
  expect(authorizationCount).toBe(1);

  host.pause();
  host.play();
  await settle();
  expect(authorizationCount).toBe(2);
});
