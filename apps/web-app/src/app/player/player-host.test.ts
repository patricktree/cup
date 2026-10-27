import { expect, test } from "@playwright/test";

import type { Audiobook, PlaybackPosition } from "@cup/listener-api.routes";

import type { NarrationAudioElement } from "#src/app/player/narration-track-player.ts";
import {
  PlaybackSession,
  type PlayableAudiobook,
  type PreparedAudiobook,
} from "#src/app/player/playback-session.ts";
import { PlayerHost, type PlayerHostAccount } from "#src/app/player/player-host.ts";

const HAVE_METADATA = 1;
const HAVE_ENOUGH_DATA = 4;
const MEDIA_ERROR_MESSAGE = "Audio could not be played. Press Play to try again.";

/**
 * An audio element that records what the player asks of it. Tests dispatch the media events a
 * browser would fire, so the order of events is under their control.
 */
class FakeAudioElement extends EventTarget implements NarrationAudioElement {
  readonly calls: string[] = [];
  preload = "";
  paused = true;
  ended = false;
  seeking = false;
  readyState = 0;
  duration = Number.NaN;
  error: { code: number } | null = null;
  /** The error the next `play()` rejects with, as a browser refusing to start. */
  nextPlayError: Error | null = null;
  private source = "";
  private time = 0;
  private loadGeneration = 0;

  get src() {
    return this.source;
  }

  set src(value: string) {
    this.calls.push(`src:${value}`);
    this.source = value;
    this.resetMedia();
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(value: number) {
    this.calls.push(`currentTime:${value}`);
    this.time = value;
  }

  play() {
    this.calls.push("play");
    const error = this.nextPlayError;
    this.nextPlayError = null;
    if (error) {
      return Promise.reject(error);
    }

    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  }

  pause() {
    this.calls.push("pause");
    if (this.paused) {
      return;
    }

    this.paused = true;
    // Browsers fire `pause` from a queued task, after the call returned. Loading another source
    // removes the element's queued event tasks.
    const loadGeneration = this.loadGeneration;
    queueMicrotask(() => {
      if (loadGeneration === this.loadGeneration) {
        this.fire("pause");
      }
    });
  }

  load() {
    this.calls.push("load");
    this.resetMedia();
  }

  removeAttribute(name: string) {
    this.calls.push(`removeAttribute:${name}`);
    if (name === "src") {
      this.source = "";
    }
  }

  /** The browser read the track's metadata. */
  loadMetadata(durationSeconds: number) {
    this.readyState = HAVE_METADATA;
    this.duration = durationSeconds;
    this.fire("durationchange");
    this.fire("loadedmetadata");
  }

  /** Moves playback forward without recording a seek, as the browser does while playing. */
  advanceTo(seconds: number) {
    this.readyState = HAVE_ENOUGH_DATA;
    this.time = seconds;
    this.fire("timeupdate");
  }

  fail() {
    this.error = { code: 2 };
    this.paused = true;
    this.fire("error");
  }

  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }

  private resetMedia() {
    this.loadGeneration += 1;
    this.readyState = 0;
    this.duration = Number.NaN;
    this.time = 0;
    this.error = null;
  }
}

function createHost({
  localPositions = new Map<string, PlaybackPosition>(),
  subject = null as string | null,
  savePosition = (): Promise<void> => Promise.resolve(),
  fetchAudiobook = (conversionId: string): Promise<Audiobook> =>
    Promise.reject(new Error(`Unexpected fetch of audiobook ${conversionId}.`)),
} = {}) {
  const elements: FakeAudioElement[] = [];
  const mediaMetadata: Array<string | null> = [];
  const saved: Array<{ position: PlaybackPosition; subject: string | null }> = [];
  const fetchedConversionIds: string[] = [];
  const clock = { now: 0 };
  let account: PlayerHostAccount = { status: "known", subject };

  const host = new PlayerHost({
    createAudioElement: () => {
      const element = new FakeAudioElement();
      elements.push(element);
      return element;
    },
    createSession: (request) =>
      new PlaybackSession(request, {
        savePosition: (position, savedSubject) => {
          saved.push({ position, subject: savedSubject });
          return savePosition();
        },
        now: () => clock.now,
      }),
    publishMediaMetadata: ({ title, artworkUrl }) => {
      mediaMetadata.push(artworkUrl ? `${title} (${artworkUrl})` : title);
      return () => mediaMetadata.push(null);
    },
    getAccount: () => account,
    getLocalPosition: (conversionId) => localPositions.get(conversionId) ?? null,
    fetchAudiobook: (conversionId) => {
      fetchedConversionIds.push(conversionId);
      return fetchAudiobook(conversionId);
    },
    now: () => clock.now,
  });
  host.accountChanged();
  /** Changes the account and reports it, like the provider does after a render. */
  const setAccount = (value: PlayerHostAccount) => {
    account = value;
    host.accountChanged();
  };
  const element = elements[0]!;
  const player = () => {
    const loaded = host.getSnapshot().loaded;
    if (!loaded) {
      throw new Error("Expected a loaded audiobook.");
    }
    return loaded.player;
  };

  return {
    host,
    elements,
    element,
    player,
    mediaMetadata,
    saved,
    fetchedConversionIds,
    clock,
    setAccount,
  };
}

/** Lets queued media events and settled saves run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The player ignores a ready segment's own audio; only the narration track plays. */
const ready = (sequence: number) => ({
  sequence,
  status: "ready" as const,
});

const UNITS = [
  { id: "unit-1", narrationText: "One" },
  { id: "unit-2", narrationText: "Two" },
  { id: "unit-3", narrationText: "Three" },
];

function createAudiobook(
  title: string,
  playbackPosition: PlaybackPosition | null = null,
): PlayableAudiobook {
  return {
    status: "ready",
    canGenerate: true,
    playbackPosition,
    title,
    originalUrl: "https://source.example.test/fixture",
    narrationDocument: { html: "<article></article>", synchronizationUnits: UNITS },
    segments: UNITS.map((_unit, sequence) => ready(sequence)),
    // Units of 4, 6 and 5 seconds.
    narrationTrack: {
      url: `https://example.com/${title}/narration-track.mp3?token=fixture`,
      durationMilliseconds: 15_000,
      startMilliseconds: [0, 4_000, 10_000],
    },
  };
}

function withoutNarrationTrack(
  audiobook: PlayableAudiobook,
  segments: PreparedAudiobook["segments"],
  status: "synthesizing" | "ready" = "ready",
): PreparedAudiobook {
  const { narrationTrack: _narrationTrack, ...rest } = audiobook;
  return { ...rest, status, segments };
}

const FIRST = createAudiobook("First");
const SECOND = createAudiobook("Second");
const FIRST_TRACK_URL = "https://example.com/First/narration-track.mp3?token=fixture";
const SECOND_TRACK_URL = "https://example.com/Second/narration-track.mp3?token=fixture";
const RENEWED_TRACK_URL = "https://example.com/First/narration-track.mp3?token=renewed";
const TWELVE_HOURS_MILLISECONDS = 12 * 60 * 60 * 1_000;
const RENEWAL_ERROR_MESSAGE = "The audio could not be loaded again. Press Play to try again.";

function withTrackUrl(audiobook: PlayableAudiobook, url: string): PlayableAudiobook {
  return { ...audiobook, narrationTrack: { ...audiobook.narrationTrack, url } };
}

test("showing an audiobook loads its narration track into the one element without playing", () => {
  const { host, elements, element, mediaMetadata } = createHost();

  host.showConversion("first", { ...FIRST, coverImage: { url: "https://example.com/cover" } });

  expect(elements).toHaveLength(1);
  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`]);
  expect(element.preload).toBe("metadata");
  expect(host.getSnapshot().loaded?.conversionId).toBe("first");
  expect(host.getSnapshot().shown?.canPlay).toBe(true);
  expect(mediaMetadata).toEqual(["First (https://example.com/cover)"]);
});

test("loading restores the saved unit and offset once metadata is loaded and stays paused", () => {
  const { host, element, player } = createHost({ subject: "user-1" });

  host.showConversion(
    "first",
    createAudiobook("First", { synchronizationUnitId: "unit-2", offsetMilliseconds: 1_500 }),
  );
  // The highlight shows the restored unit before the browser read the track.
  expect(player().getSnapshot()).toMatchObject({
    currentUnitIndex: 1,
    positionMilliseconds: 5_500,
    durationMilliseconds: 15_000,
    isPlaying: false,
  });
  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`]);

  element.loadMetadata(15.2);

  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`, "currentTime:5.5"]);
  expect(element.paused).toBe(true);
  expect(player().getSnapshot()).toMatchObject({
    currentUnitIndex: 1,
    positionMilliseconds: 5_500,
    durationMilliseconds: 15_200,
    isPlaying: false,
  });
});

test("Play starts the element within the call, before anything is awaited", () => {
  const { host, element, player } = createHost();
  host.showConversion("first", FIRST);

  host.playShown();

  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`, "play"]);
  expect(player().getSnapshot().isPlaying).toBe(true);
  expect(player().getSnapshot().isBuffering).toBe(true);

  element.advanceTo(0.25);
  expect(player().getSnapshot().isBuffering).toBe(false);
});

test("toggling pauses a playing audiobook and plays a paused one", () => {
  const { host, element } = createHost();
  host.showConversion("first", FIRST);
  host.playShown();

  host.togglePlayback();
  expect(element.calls.at(-1)).toBe("pause");
  expect(element.paused).toBe(true);

  host.togglePlayback();
  expect(element.calls.at(-1)).toBe("play");
  expect(element.paused).toBe(false);
});

test("a unit tap sets the element's time to the unit's start offset", () => {
  const { host, element, player } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);

  host.playShown(2);

  expect(element.calls.slice(1)).toEqual(["currentTime:10", "play"]);
  expect(player().getSnapshot().currentUnitIndex).toBe(2);
});

test("a unit tap before metadata is loaded seeks once it is", () => {
  const { host, element, player } = createHost({ subject: "user-1" });
  host.showConversion(
    "first",
    createAudiobook("First", { synchronizationUnitId: "unit-3", offsetMilliseconds: 1_000 }),
  );

  host.playShown(1);
  expect(player().getSnapshot().currentUnitIndex).toBe(1);
  element.loadMetadata(15);

  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`, "play", "currentTime:4"]);
});

test("the position bar sets the element's time, short of the track's end", () => {
  const { host, element, player } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);

  player().seekTo(7_000);
  player().seekTo(20_000);

  expect(element.calls.slice(1)).toEqual(["currentTime:7", "currentTime:14.999"]);
  expect(element.calls).not.toContain("play");
});

test("the current unit follows the element's time across start offsets", () => {
  const { host, element, player } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();

  const unitAt = (seconds: number) => {
    element.advanceTo(seconds);
    return player().getSnapshot().currentUnitIndex;
  };

  expect([unitAt(0), unitAt(3.999), unitAt(4), unitAt(9.5), unitAt(10), unitAt(14.9)]).toEqual([
    0, 0, 1, 1, 2, 2,
  ]);
  expect(player().getSnapshot().positionMilliseconds).toBe(14_900);
});

test("time updates of the same position publish no new snapshot", () => {
  const { host, element, player } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  let notifications = 0;
  player().subscribe(() => {
    notifications += 1;
  });

  element.advanceTo(1);
  element.advanceTo(1);
  element.advanceTo(1);

  expect(notifications).toBe(1);
});

test("saves during playback at most every save interval, and on pause", async () => {
  const { host, element, saved, clock } = createHost({ subject: "user-1" });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();

  for (let second = 1; second <= 11; second += 1) {
    clock.now = second * 1_000;
    element.advanceTo(second);
  }
  // A time update while seeking reports where the seek started, not a listening position.
  element.seeking = true;
  clock.now = 20_000;
  element.advanceTo(2);
  element.seeking = false;
  element.advanceTo(12.5);
  host.pause();
  await settle();

  expect(saved.map(({ position }) => position)).toEqual([
    { synchronizationUnitId: "unit-1", offsetMilliseconds: 1_000 },
    { synchronizationUnitId: "unit-2", offsetMilliseconds: 2_000 },
    { synchronizationUnitId: "unit-3", offsetMilliseconds: 1_000 },
    { synchronizationUnitId: "unit-3", offsetMilliseconds: 2_500 },
    { synchronizationUnitId: "unit-3", offsetMilliseconds: 2_500 },
  ]);
  expect(saved.every(({ subject }) => subject === "user-1")).toBe(true);
});

test("seeking saves the new position right away", async () => {
  const { host, element, saved } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);

  host.playShown(1);
  await settle();

  expect(saved.map(({ position }) => position)).toEqual([
    { synchronizationUnitId: "unit-2", offsetMilliseconds: 0 },
  ]);
});

test("skipping moves the element's time by the given amount and saves the new position", async () => {
  const { host, element, player, saved } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();
  element.advanceTo(12.5);

  player().skipBy(-5_000);
  player().skipBy(2_000);
  await settle();

  expect(element.calls.slice(2)).toEqual(["currentTime:7.5", "currentTime:9.5"]);
  expect(player().getSnapshot().currentUnitIndex).toBe(1);
  expect(saved.map(({ position }) => position)).toEqual([
    // the first time update during playback is due
    { synchronizationUnitId: "unit-3", offsetMilliseconds: 2_500 },
    { synchronizationUnitId: "unit-2", offsetMilliseconds: 3_500 },
    { synchronizationUnitId: "unit-2", offsetMilliseconds: 5_500 },
  ]);
});

test("skipping back stops at the start, and skipping forward short of the end", () => {
  const { host, element, player } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();

  element.advanceTo(14);
  player().skipBy(-15_000);
  element.advanceTo(3);
  player().skipBy(15_000);

  expect(element.calls.slice(2)).toEqual(["currentTime:0", "currentTime:14.999"]);
  expect(player().getSnapshot().positionMilliseconds).toBe(14_999);
});

test("skipping before metadata is loaded skips from the restored position once it is", () => {
  const { host, element, player } = createHost({ subject: "user-1" });
  host.showConversion(
    "first",
    createAudiobook("First", { synchronizationUnitId: "unit-3", offsetMilliseconds: 2_000 }),
  );

  player().skipBy(-5_000);
  element.loadMetadata(15);

  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`, "currentTime:7"]);
});

test("a refused save is shown as the player's error", async () => {
  const { host, element, player } = createHost({
    subject: "user-1",
    savePosition: () => Promise.reject(new Error("Sign in again to continue playback.")),
  });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);

  player().seekTo(2_000);
  await settle();

  expect(player().getSnapshot().error).toBe("Sign in again to continue playback.");
});

test("reaching the end returns to the start and saves it", async () => {
  const { host, element, player, saved } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();

  element.advanceTo(15);
  element.paused = true;
  element.ended = true;
  element.fire("pause");
  element.fire("ended");
  await settle();

  expect(element.calls.at(-1)).toBe("currentTime:0");
  expect(player().getSnapshot()).toMatchObject({ isPlaying: false, currentUnitIndex: 0 });
  expect(saved.at(-1)?.position).toEqual({
    synchronizationUnitId: "unit-1",
    offsetMilliseconds: 0,
  });
});

test("Play within 12 hours of receiving the track URL plays it without a refetch", () => {
  const { host, element, fetchedConversionIds, clock } = createHost();
  host.showConversion("first", FIRST);
  element.loadMetadata(15);

  clock.now = TWELVE_HOURS_MILLISECONDS;
  host.play();

  expect(fetchedConversionIds).toEqual([]);
  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`, "play"]);
});

test("Play more than 12 hours after receiving the track URL renews it and keeps the position", async () => {
  const { host, element, player, fetchedConversionIds, clock } = createHost({
    fetchAudiobook: () => Promise.resolve(withTrackUrl(FIRST, RENEWED_TRACK_URL)),
  });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();
  element.advanceTo(6);
  host.pause();
  await settle();

  clock.now = TWELVE_HOURS_MILLISECONDS + 1;
  host.play();
  await settle();

  expect(fetchedConversionIds).toEqual(["first"]);
  expect(element.calls.slice(-2)).toEqual([`src:${RENEWED_TRACK_URL}`, "play"]);
  expect(player().getSnapshot()).toMatchObject({ isPlaying: true, positionMilliseconds: 6_000 });
  element.loadMetadata(15);
  expect(element.calls.at(-1)).toBe("currentTime:6");

  // The renewed URL is fresh: the next Play needs no refetch.
  host.pause();
  host.play();
  expect(fetchedConversionIds).toEqual(["first"]);
});

test("the age of a shown audiobook's track URL counts from when the page received it", async () => {
  const { host, element, fetchedConversionIds, clock } = createHost({
    fetchAudiobook: () =>
      Promise.resolve(
        withTrackUrl(SECOND, "https://example.com/Second/narration-track.mp3?token=renewed"),
      ),
  });
  host.showConversion("first", FIRST);
  host.hideConversion("first");
  host.showConversion("second", SECOND);

  clock.now = TWELVE_HOURS_MILLISECONDS + 1;
  host.playShown();
  await settle();

  expect(fetchedConversionIds).toEqual(["second"]);
  expect(element.calls.slice(-2)).toEqual([
    "src:https://example.com/Second/narration-track.mp3?token=renewed",
    "play",
  ]);
});

test("a unit tap that renews the track URL seeks to the unit once the renewed track is loaded", async () => {
  const { host, element, clock } = createHost({
    fetchAudiobook: () => Promise.resolve(withTrackUrl(FIRST, RENEWED_TRACK_URL)),
  });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);

  clock.now = TWELVE_HOURS_MILLISECONDS + 1;
  host.playShown(2);
  await settle();
  element.loadMetadata(15);

  expect(element.calls.slice(1)).toEqual([
    "currentTime:10",
    `src:${RENEWED_TRACK_URL}`,
    "play",
    "currentTime:10",
  ]);
});

test("a media error is shown, and Play renews the track URL and resumes at the same position", async () => {
  const { host, element, player, fetchedConversionIds } = createHost({
    fetchAudiobook: () => Promise.resolve(withTrackUrl(FIRST, RENEWED_TRACK_URL)),
  });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();
  element.advanceTo(6);

  element.fail();
  expect(player().getSnapshot()).toMatchObject({ isPlaying: false, error: MEDIA_ERROR_MESSAGE });

  host.play();
  await settle();

  expect(fetchedConversionIds).toEqual(["first"]);
  expect(element.calls.slice(-2)).toEqual([`src:${RENEWED_TRACK_URL}`, "play"]);
  expect(player().getSnapshot()).toMatchObject({ error: null, positionMilliseconds: 6_000 });
  element.loadMetadata(15);
  expect(element.calls.at(-1)).toBe("currentTime:6");
});

test("a refused renewal keeps playback stopped and shows an error", async () => {
  const { host, element, player, clock } = createHost({
    fetchAudiobook: () => Promise.reject(new Error("Forbidden")),
  });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);

  clock.now = TWELVE_HOURS_MILLISECONDS + 1;
  host.play();
  await settle();

  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`]);
  expect(player().getSnapshot()).toMatchObject({
    isPlaying: false,
    error: RENEWAL_ERROR_MESSAGE,
  });
});

test("an audiobook response without a narration track refuses the renewal", async () => {
  const { host, element, player, clock } = createHost({
    fetchAudiobook: () =>
      Promise.resolve(
        withoutNarrationTrack(FIRST, [
          ready(0),
          { sequence: 1, status: "failed", explanation: "Rejected" },
          ready(2),
        ]),
      ),
  });
  host.showConversion("first", FIRST);

  clock.now = TWELVE_HOURS_MILLISECONDS + 1;
  host.play();
  await settle();

  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`]);
  expect(player().getSnapshot().error).toBe(RENEWAL_ERROR_MESSAGE);
});

test("a play refused after the renewal leaves Play available", async () => {
  const { host, element, player, fetchedConversionIds, clock } = createHost({
    fetchAudiobook: () => Promise.resolve(withTrackUrl(FIRST, RENEWED_TRACK_URL)),
  });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  clock.now = TWELVE_HOURS_MILLISECONDS + 1;
  element.nextPlayError = new DOMException("Not allowed", "NotAllowedError");

  host.play();
  await settle();
  expect(player().getSnapshot()).toMatchObject({ isPlaying: false, error: MEDIA_ERROR_MESSAGE });

  host.play();
  expect(element.calls.at(-1)).toBe("play");
  expect(player().getSnapshot()).toMatchObject({ isPlaying: true, error: null });
  expect(fetchedConversionIds).toEqual(["first"]);
});

test("Pause during a renewal keeps the track paused", async () => {
  const { host, element, player, fetchedConversionIds, clock } = createHost({
    fetchAudiobook: () => Promise.resolve(withTrackUrl(FIRST, RENEWED_TRACK_URL)),
  });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);

  clock.now = TWELVE_HOURS_MILLISECONDS + 1;
  host.play();
  host.play();
  host.pause();
  await settle();

  expect(fetchedConversionIds).toEqual(["first"]);
  expect(element.calls).not.toContain("play");
  expect(player().getSnapshot().isPlaying).toBe(false);
});

test("a renewal that completes after unloading plays nothing", async () => {
  const { host, element, clock } = createHost({
    fetchAudiobook: () => Promise.resolve(withTrackUrl(FIRST, RENEWED_TRACK_URL)),
  });
  host.showConversion("first", FIRST);

  clock.now = TWELVE_HOURS_MILLISECONDS + 1;
  host.play();
  host.unload();
  await settle();

  expect(element.calls.slice(-2)).toEqual(["removeAttribute:src", "load"]);
});

test("a refused play is shown, and Play stays available", async () => {
  const { host, element, player } = createHost();
  host.showConversion("first", FIRST);
  element.nextPlayError = new DOMException("Not allowed", "NotAllowedError");

  host.play();
  await settle();

  expect(player().getSnapshot()).toMatchObject({ isPlaying: false, error: MEDIA_ERROR_MESSAGE });
  host.play();
  expect(player().getSnapshot()).toMatchObject({ isPlaying: true, error: null });
});

test("playing another audiobook sets its narration track on the same element", async () => {
  const { host, elements, element, mediaMetadata, saved } = createHost();

  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();
  element.advanceTo(3);
  host.hideConversion("first");
  host.showConversion("second", SECOND);
  // Showing another audiobook keeps the loaded one playing.
  expect(host.getSnapshot().loaded?.conversionId).toBe("first");
  expect(element.paused).toBe(false);

  host.playShown(2);
  await settle();

  expect(elements).toHaveLength(1);
  expect(element.calls.slice(-3)).toEqual(["pause", `src:${SECOND_TRACK_URL}`, "play"]);
  expect(host.getSnapshot().loaded?.conversionId).toBe("second");
  expect(mediaMetadata).toEqual(["First", null, "Second"]);
  // The previous audiobook's position is saved when it is replaced.
  expect(saved[0]?.position).toEqual({
    synchronizationUnitId: "unit-1",
    offsetMilliseconds: 3_000,
  });

  element.loadMetadata(15);
  expect(element.calls.at(-1)).toBe("currentTime:10");
});

test("seeking the shown audiobook while another one plays loads it paused at that position", async () => {
  const { host, element, saved } = createHost();

  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();
  element.advanceTo(3);
  host.hideConversion("first");
  host.showConversion("second", SECOND);

  const callCountBeforeSeek = element.calls.length;
  host.loadShown()?.seekTo(12_000);
  await settle();

  expect(host.getSnapshot().loaded?.conversionId).toBe("second");
  expect(element.paused).toBe(true);
  expect(saved[0]?.position).toEqual({
    synchronizationUnitId: "unit-1",
    offsetMilliseconds: 3_000,
  });

  element.loadMetadata(15);
  expect(element.calls.slice(callCountBeforeSeek)).toEqual([
    "pause",
    `src:${SECOND_TRACK_URL}`,
    "currentTime:12",
  ]);
});

test("the shown audiobook without a narration track loads nothing, and Play leaves the loaded one", () => {
  const { host, element } = createHost();

  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.hideConversion("first");
  host.showConversion(
    "second",
    withoutNarrationTrack(
      SECOND,
      [ready(0), { sequence: 1, status: "generating" }, ready(2)],
      "synthesizing",
    ),
  );

  expect(host.loadShown()).toBeNull();
  host.playShown();

  expect(host.getSnapshot().loaded?.conversionId).toBe("first");
  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`]);
});

test("an audiobook without a narration track is never loaded", () => {
  const { host, element } = createHost();

  for (const audiobook of [
    withoutNarrationTrack(
      FIRST,
      [ready(0), { sequence: 1, status: "generating" }, { sequence: 2, status: "generating" }],
      "synthesizing",
    ),
    withoutNarrationTrack(FIRST, [
      ready(0),
      { sequence: 1, status: "failed", explanation: "Rejected" },
      ready(2),
    ]),
  ]) {
    host.showConversion("first", audiobook);
    host.playShown();
    host.playShown(0);

    expect(host.getSnapshot().loaded).toBeNull();
    expect(host.getSnapshot().shown?.canPlay).toBe(false);
  }
  expect(element.calls).toEqual([]);
});

test("an audiobook is loaded once its narration track exists while shown", () => {
  const { host, element } = createHost();

  host.showConversion(
    "first",
    withoutNarrationTrack(FIRST, [
      ready(0),
      { sequence: 1, status: "generating" },
      { sequence: 2, status: "generating" },
    ]),
  );
  expect(element.calls).toEqual([]);

  host.showConversion("first", FIRST);
  expect(element.calls).toEqual([`src:${FIRST_TRACK_URL}`]);
});

test("loading waits until the account is restored and uses its listening position", () => {
  const { host, element, player, setAccount } = createHost();
  const serverPosition = { synchronizationUnitId: "unit-2", offsetMilliseconds: 1_000 };
  setAccount({ status: "restoring" });

  host.showConversion("first", createAudiobook("First", serverPosition));
  expect(element.calls).toEqual([]);

  setAccount({ status: "known", subject: "user-1" });
  expect(host.getSnapshot().loaded?.subject).toBe("user-1");
  expect(player().getSnapshot().positionMilliseconds).toBe(5_000);
});

test("listeners without an account resume from the device's listening position", () => {
  const localPosition = { synchronizationUnitId: "unit-3", offsetMilliseconds: 500 };
  const { host, player } = createHost({ localPositions: new Map([["first", localPosition]]) });

  host.showConversion(
    "first",
    createAudiobook("First", { synchronizationUnitId: "unit-2", offsetMilliseconds: 1_000 }),
  );

  expect(host.getSnapshot().loaded?.subject).toBeNull();
  expect(player().getSnapshot().positionMilliseconds).toBe(10_500);
});

test("a change of the signed-in user unloads the element", async () => {
  const { host, element, mediaMetadata, saved, setAccount } = createHost({ subject: "user-1" });
  host.showConversion("first", FIRST);
  element.loadMetadata(15);
  host.play();
  element.advanceTo(2);

  setAccount({ status: "known", subject: "user-2" });
  await settle();

  expect(element.calls.slice(-4)).toEqual([
    "pause",
    "removeAttribute:src",
    "load",
    `src:${FIRST_TRACK_URL}`,
  ]);
  expect(saved.map(({ subject }) => subject)).toEqual(["user-1", "user-1"]);
  expect(mediaMetadata).toEqual(["First", null, "First"]);
  // The shown audiobook loads again, for the new user.
  expect(host.getSnapshot().loaded?.subject).toBe("user-2");
  expect(element.src).toBe(FIRST_TRACK_URL);
});

test("unloading leaves the element empty and paused", async () => {
  const { host, element, mediaMetadata } = createHost();
  host.showConversion("first", FIRST);
  host.play();

  host.unload();
  await settle();

  expect(element.calls.slice(-3)).toEqual(["pause", "removeAttribute:src", "load"]);
  expect(host.getSnapshot().loaded).toBeNull();
  expect(mediaMetadata).toEqual(["First", null]);
});
