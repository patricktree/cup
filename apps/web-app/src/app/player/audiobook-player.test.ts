import { expect, test } from "@playwright/test";

import type { AudiobookAudioElement } from "#src/app/player/audio-element-pair.ts";
import type { AudiobookPlayerSession } from "#src/app/player/audiobook-player-machine.ts";
import { AudiobookPlayer } from "#src/app/player/audiobook-player.ts";
import { createAudiobookTimeline } from "#src/app/player/audiobook-timeline.ts";
import type { ReportedPosition, TimelineLocation } from "#src/platform/player.ts";

const SILENCE_URL = "https://app.example.test/silence.wav";
const SEGMENT_DURATION_MILLISECONDS = 10_000;
const MEDIA_ERROR_MESSAGE = "Audio could not be played. Press Play to try again.";

const segmentUrl = (sequence: number) => `https://example.test/segments/${sequence}/audio.mp3`;

/**
 * An audio element that records what the engine asks of it. Tests dispatch the media events a
 * browser would fire, so the order of events is under their control.
 */
class FakeAudioElement extends EventTarget implements AudiobookAudioElement {
  readonly calls: string[] = [];
  readonly sources: string[] = [];
  muted = false;
  paused = true;
  ended = false;
  seeking = false;
  duration = SEGMENT_DURATION_MILLISECONDS / 1_000;
  /** The error the next `play()` rejects with, as a browser refusing to start. */
  nextPlayError: Error | null = null;
  private source = "";
  private time = 0;

  get src() {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    this.sources.push(value);
    this.time = 0;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(value: number) {
    this.time = value;
    this.calls.push(`currentTime:${value}`);
  }

  /** Moves playback forward without recording a seek, as the browser does while playing. */
  advanceTo(seconds: number) {
    this.time = seconds;
    this.fire("timeupdate");
  }

  play() {
    this.calls.push(this.muted ? "play:muted" : "play");
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
    this.paused = true;
  }

  load() {
    this.calls.push("load");
  }

  removeAttribute(name: string) {
    if (name === "src") {
      this.source = "";
      this.calls.push("removeAttribute:src");
    }
  }

  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }

  /** Whether the element is audibly playing its loaded segment. */
  get isAudible() {
    return !this.paused && !this.muted;
  }
}

type Deferred = { resolve: () => void; reject: (error: Error) => void };
type RecordedSave = { when: "now" | "if-due"; position: ReportedPosition };

function createFixture({
  initialLocation = { entryIndex: 0, offsetMilliseconds: 0 },
  segmentCount = 3,
  shouldHoldAuthorization = false,
}: {
  initialLocation?: TimelineLocation;
  segmentCount?: number;
  shouldHoldAuthorization?: boolean;
} = {}) {
  const timeline = createAudiobookTimeline(
    Array.from({ length: segmentCount }, (_, sequence) => ({
      sequence,
      status: "ready" as const,
      durationMilliseconds: SEGMENT_DURATION_MILLISECONDS,
      url: segmentUrl(sequence),
    })),
  );
  const saves: RecordedSave[] = [];
  const pendingAuthorizations: Deferred[] = [];
  const state = { shouldHoldAuthorization, authorizationCount: 0, saveError: null as Error | null };

  const reportedPositionAt = (location: TimelineLocation): ReportedPosition => {
    const entry = timeline.entries[location.entryIndex];
    return {
      currentUnitIndex: entry?.unitIndex ?? 0,
      positionMilliseconds: (entry?.startMilliseconds ?? 0) + location.offsetMilliseconds,
    };
  };
  const recordSave = (when: "now" | "if-due", position: ReportedPosition) => {
    saves.push({ when, position });
    return state.saveError ? Promise.reject(state.saveError) : Promise.resolve();
  };
  const session: AudiobookPlayerSession = {
    timeline,
    initialLocation,
    reportedPositionAt,
    adjacentUnitIndex: (unitIndex, direction) => {
      const entryIndex = timeline.entries.findIndex((entry) => entry.unitIndex === unitIndex);
      return entryIndex < 0 ? undefined : timeline.entries[entryIndex + direction]?.unitIndex;
    },
    authorizeMedia: () => {
      state.authorizationCount += 1;
      if (!state.shouldHoldAuthorization) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        pendingAuthorizations.push({ resolve, reject });
      });
    },
    save: (position) => recordSave("now", position),
    saveIfDue: (position) => recordSave("if-due", position),
  };

  const elements: FakeAudioElement[] = [];
  const player = new AudiobookPlayer(session, {
    createAudioElement: () => {
      const element = new FakeAudioElement();
      elements.push(element);
      return element;
    },
    silenceUrl: SILENCE_URL,
  });

  const element = (index: number) => {
    const found = elements[index];
    if (!found) {
      throw new Error(`Audio element ${index} was not created.`);
    }
    return found;
  };

  return { player, element, saves, pendingAuthorizations, state };
}

/** Lets pending promise callbacks, such as an authorization or a started element, run. */
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const nowSaves = (saves: RecordedSave[]) => saves.filter((save) => save.when === "now");

test("opening loads the restored segment and preloads the following one", async () => {
  const { player, element } = createFixture({
    initialLocation: { entryIndex: 1, offsetMilliseconds: 4_000 },
  });

  player.open();
  await settle();

  expect(element(0).src).toBe(segmentUrl(1));
  expect(element(1).src).toBe(segmentUrl(2));
  element(0).fire("loadedmetadata");
  expect(element(0).currentTime).toBe(4);
  expect(player.getSnapshot()).toMatchObject({
    currentUnitIndex: 1,
    positionMilliseconds: 14_000,
    durationMilliseconds: 30_000,
    isPlaying: false,
  });
});

test("play after authorization starts the active element and unlocks the standby one", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();

  player.play();

  expect(element(0).calls).toContain("play");
  expect(element(1).calls).toContain("play:muted");
  expect(element(1).src).toBe(segmentUrl(1));
  expect(player.getSnapshot()).toMatchObject({ isPlaying: true, error: null });

  await settle();
  expect(element(0).isAudible).toBe(true);
  // The unlocked standby element stops at the start of its preloaded segment and is unmuted again.
  expect(element(1).paused).toBe(true);
  expect(element(1).currentTime).toBe(0);
  expect(element(1).muted).toBe(false);
});

test("play before authorization unlocks both elements with silence and starts afterwards", async () => {
  const { player, element, pendingAuthorizations } = createFixture({
    shouldHoldAuthorization: true,
  });
  player.open();

  player.play();

  // Both elements are started synchronously within the gesture, before any segment may load.
  expect(element(0).sources).toEqual([SILENCE_URL]);
  expect(element(1).sources).toEqual([SILENCE_URL]);
  expect(element(0).calls).toContain("play:muted");
  expect(element(1).calls).toContain("play:muted");
  expect(player.getSnapshot().isPlaying).toBe(true);

  pendingAuthorizations.shift()?.resolve();
  await settle();
  pendingAuthorizations.shift()?.resolve();
  await settle();

  expect(element(0).src).toBe(segmentUrl(0));
  expect(element(0).isAudible).toBe(true);
  expect(element(1).src).toBe(segmentUrl(1));
});

test("a pause while authorization is pending does not start playback afterwards", async () => {
  const { player, element, pendingAuthorizations } = createFixture({
    shouldHoldAuthorization: true,
  });
  player.open();
  player.play();
  player.pause();

  pendingAuthorizations.shift()?.resolve();
  await settle();

  expect(element(0).src).toBe(segmentUrl(0));
  expect(element(0).calls.filter((call) => call === "play")).toEqual([]);
  expect(player.getSnapshot().isPlaying).toBe(false);
});

test("a seek while authorization is pending becomes the position loaded afterwards", async () => {
  const { player, element, saves, pendingAuthorizations } = createFixture({
    shouldHoldAuthorization: true,
  });
  player.open();

  player.seekTo(25_000);

  expect(player.getSnapshot()).toMatchObject({ currentUnitIndex: 2, positionMilliseconds: 25_000 });
  expect(nowSaves(saves).at(-1)?.position).toEqual({
    currentUnitIndex: 2,
    positionMilliseconds: 25_000,
  });

  pendingAuthorizations.shift()?.resolve();
  await settle();
  expect(element(0).src).toBe(segmentUrl(2));
  element(0).fire("loadedmetadata");
  expect(element(0).currentTime).toBe(5);
});

test("a segment boundary continues on the preloaded standby element", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();

  element(0).fire("ended");

  expect(element(1).isAudible).toBe(true);
  expect(player.getSnapshot()).toMatchObject({
    currentUnitIndex: 1,
    positionMilliseconds: 10_000,
    isPlaying: true,
  });

  await settle();
  // The previous element now preloads the segment after the new one.
  expect(element(0).src).toBe(segmentUrl(2));
});

test("media authorization is renewed before each preload", async () => {
  const { player, element, state } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();
  const authorizationCount = state.authorizationCount;

  element(0).fire("ended");
  await settle();

  expect(state.authorizationCount).toBe(authorizationCount + 1);
});

test("the end of the last segment wraps to the start and pauses", async () => {
  const { player, element, saves } = createFixture({ segmentCount: 1 });
  player.open();
  await settle();
  player.play();
  await settle();

  element(0).fire("ended");

  expect(player.getSnapshot()).toMatchObject({
    currentUnitIndex: 0,
    positionMilliseconds: 0,
    isPlaying: false,
    isBuffering: false,
  });
  expect(element(0).sources.at(-1)).toBe(segmentUrl(0));
  expect(nowSaves(saves).at(-1)?.position).toEqual({
    currentUnitIndex: 0,
    positionMilliseconds: 0,
  });
});

test("a seek within the active segment moves the active element", async () => {
  const { player, element, saves } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();
  const sourceCount = element(0).sources.length;

  player.seekTo(4_000);

  expect(element(0).sources).toHaveLength(sourceCount);
  expect(element(0).currentTime).toBe(4);
  expect(element(0).isAudible).toBe(true);
  expect(player.getSnapshot()).toMatchObject({ currentUnitIndex: 0, positionMilliseconds: 4_000 });
  expect(nowSaves(saves).at(-1)?.position.positionMilliseconds).toBe(4_000);
});

test("a seek onto the preloaded segment swaps to the standby element", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();

  player.seekTo(13_000);

  expect(element(0).paused).toBe(true);
  expect(element(1).sources).toEqual([segmentUrl(1)]);
  expect(element(1).currentTime).toBe(3);
  expect(element(1).isAudible).toBe(true);
  expect(player.getSnapshot()).toMatchObject({ currentUnitIndex: 1, positionMilliseconds: 13_000 });
});

test("a seek onto an unloaded segment loads it into the standby element", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();
  const activeSources = [...element(0).sources];

  player.seekToUnit(2);

  // The element the media controls follow keeps its source; Android would recreate them otherwise.
  expect(element(0).sources).toEqual(activeSources);
  expect(element(0).paused).toBe(true);
  expect(element(1).src).toBe(segmentUrl(2));
  expect(element(1).isAudible).toBe(true);
  expect(player.getSnapshot()).toMatchObject({ currentUnitIndex: 2, positionMilliseconds: 20_000 });
});

test("a seek to an offset in an unloaded segment applies once its metadata loads", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();

  player.seekTo(27_000);
  element(1).fire("loadedmetadata");

  expect(element(1).src).toBe(segmentUrl(2));
  expect(element(1).currentTime).toBe(7);
  expect(player.getSnapshot().isPlaying).toBe(false);
});

test("skipping moves to the adjacent segment", async () => {
  const { player } = createFixture();
  player.open();
  await settle();

  player.skip(1);
  expect(player.getSnapshot().currentUnitIndex).toBe(1);
  player.skip(-1);
  expect(player.getSnapshot().currentUnitIndex).toBe(0);
  player.skip(-1);
  expect(player.getSnapshot().currentUnitIndex).toBe(0);
});

test("time updates of the active element report the position and save when due", async () => {
  const { player, element, saves } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();

  element(0).advanceTo(2.5);

  expect(player.getSnapshot().positionMilliseconds).toBe(2_500);
  expect(saves.at(-1)).toEqual({
    when: "if-due",
    position: { currentUnitIndex: 0, positionMilliseconds: 2_500 },
  });

  // The standby element's progress is not the listener's position.
  element(1).advanceTo(1);
  expect(player.getSnapshot().positionMilliseconds).toBe(2_500);
});

test("the snapshot stays the same object until something changes", async () => {
  const { player, element } = createFixture();
  const notifications: number[] = [];
  player.subscribe(() => notifications.push(notifications.length));
  player.open();
  await settle();
  const before = player.getSnapshot();

  expect(player.getSnapshot()).toBe(before);

  player.play();
  expect(player.getSnapshot()).not.toBe(before);
  expect(notifications.length).toBeGreaterThan(0);
  const playing = player.getSnapshot();
  expect(player.getSnapshot()).toBe(playing);

  element(0).advanceTo(1);
  expect(player.getSnapshot()).not.toBe(playing);
  expect(player.getSnapshot().positionMilliseconds).toBe(1_000);
});

test("waiting and playing events report buffering while playing", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();

  element(0).fire("waiting");
  expect(player.getSnapshot().isBuffering).toBe(false);

  player.play();
  await settle();
  element(0).fire("waiting");
  expect(player.getSnapshot().isBuffering).toBe(true);
  element(0).fire("playing");
  expect(player.getSnapshot().isBuffering).toBe(false);
});

test("a pause made outside the player pauses it and saves", async () => {
  const { player, element, saves } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();
  const saveCount = nowSaves(saves).length;

  element(0).pause();
  element(0).fire("pause");

  expect(player.getSnapshot().isPlaying).toBe(false);
  expect(nowSaves(saves)).toHaveLength(saveCount + 1);
});

test("a pause event from a restarted element is ignored", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();

  // A seek pauses and restarts the element; its pause event arrives once it plays again.
  player.seekTo(2_000);
  element(0).fire("pause");

  expect(player.getSnapshot().isPlaying).toBe(true);
});

test("a media error on the active element stops playback with a message", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();

  element(0).fire("error");

  expect(player.getSnapshot()).toMatchObject({
    isPlaying: false,
    isBuffering: false,
    error: MEDIA_ERROR_MESSAGE,
  });

  // Play tries again, loading the segment anew.
  player.play();
  expect(player.getSnapshot()).toMatchObject({ isPlaying: true, error: null });
  expect(element(0).sources.at(-1)).toBe(segmentUrl(0));
  expect(element(0).calls.at(-1)).toBe("play");
});

test("a media error while Play waits for authorization cancels the start", async () => {
  const { player, element, pendingAuthorizations } = createFixture({
    shouldHoldAuthorization: true,
  });
  player.open();
  player.play();

  element(0).fire("error");

  expect(player.getSnapshot()).toMatchObject({ isPlaying: false, error: MEDIA_ERROR_MESSAGE });
  pendingAuthorizations.shift()?.resolve();
  await settle();
  expect(element(0).src).toBe(segmentUrl(0));
  expect(element(0).calls.filter((call) => call === "play")).toEqual([]);
});

test("a preload authorized after close loads nothing", async () => {
  const { player, element, pendingAuthorizations, state } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();
  state.shouldHoldAuthorization = true;
  element(0).fire("ended");

  player.close();
  pendingAuthorizations.shift()?.resolve();
  await settle();

  expect(element(0).sources).toEqual([segmentUrl(0)]);
});

test("a media error on the standby element reloads its segment when playback reaches it", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();

  element(1).fire("error");
  expect(player.getSnapshot()).toMatchObject({ isPlaying: true, error: null });

  const sourceCount = element(1).sources.length;
  element(0).fire("ended");

  expect(element(1).sources).toHaveLength(sourceCount + 1);
  expect(element(1).src).toBe(segmentUrl(1));
  expect(element(1).isAudible).toBe(true);
});

test("a refused start reports the browser's message", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();
  element(0).nextPlayError = new DOMException("Playback was refused.", "NotAllowedError");

  player.play();
  await settle();

  expect(player.getSnapshot()).toMatchObject({
    isPlaying: false,
    error: "Playback was refused.",
  });
});

test("an interrupted start is not reported", async () => {
  const { player, element } = createFixture();
  player.open();
  await settle();
  element(0).nextPlayError = new DOMException("Interrupted.", "AbortError");

  player.play();
  await settle();

  expect(player.getSnapshot()).toMatchObject({ isPlaying: true, error: null });
});

test("pausing saves the position", async () => {
  const { player, element, saves } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();
  element(0).advanceTo(3);

  player.pause();

  expect(element(0).paused).toBe(true);
  expect(player.getSnapshot().isPlaying).toBe(false);
  expect(saves.at(-1)).toEqual({
    when: "now",
    position: { currentUnitIndex: 0, positionMilliseconds: 3_000 },
  });
});

test("a failed save is reported", async () => {
  const { player, state } = createFixture();
  player.open();
  await settle();
  state.saveError = new Error("Position could not be saved.");

  player.seekTo(1_000);
  await settle();

  expect(player.getSnapshot().error).toBe("Position could not be saved.");
});

test("closing saves, releases both elements, and ignores their later events", async () => {
  const { player, element, saves } = createFixture();
  player.open();
  await settle();
  player.play();
  await settle();
  element(0).advanceTo(6);
  const saveCount = nowSaves(saves).length;

  player.close();

  expect(nowSaves(saves)).toHaveLength(saveCount + 1);
  expect(nowSaves(saves).at(-1)?.position.positionMilliseconds).toBe(6_000);
  for (const index of [0, 1]) {
    expect(element(index).paused).toBe(true);
    expect(element(index).src).toBe("");
    expect(element(index).calls.slice(-2)).toEqual(["removeAttribute:src", "load"]);
  }
  expect(player.getSnapshot()).toMatchObject({ isPlaying: false, isBuffering: false });

  const snapshot = player.getSnapshot();
  element(0).advanceTo(8);
  element(0).fire("error");
  expect(player.getSnapshot()).toBe(snapshot);

  player.play();
  expect(player.getSnapshot().isPlaying).toBe(false);
});

test("an authorization finishing after close loads nothing", async () => {
  const { player, element, pendingAuthorizations } = createFixture({
    shouldHoldAuthorization: true,
  });
  player.open();
  player.close();

  pendingAuthorizations.shift()?.resolve();
  await settle();

  expect(element(0).sources).toEqual([]);
});

test("an audiobook without audio never plays", async () => {
  const { player, element } = createFixture({ segmentCount: 0 });
  player.open();
  await settle();

  player.play();

  expect(player.getSnapshot().isPlaying).toBe(false);
  expect(element(0).calls).toEqual([]);
});
