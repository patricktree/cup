import { clampToTimeline, findUnitIndexAt } from "#src/app/player/audiobook-timeline.ts";
import type { PlaybackSession } from "#src/app/player/playback-session.ts";

/** What the player uses of the host's `<audio>` element. */
export type NarrationAudioElement = EventTarget & {
  src: string;
  currentTime: number;
  preload: string;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly seeking: boolean;
  readonly readyState: number;
  readonly error: { code: number } | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
};

/** The loaded audiobook's playback, on the whole-audiobook timeline. */
export type PlayerSnapshot = {
  currentUnitIndex: number;
  positionMilliseconds: number;
  durationMilliseconds: number;
  isPlaying: boolean;
  isBuffering: boolean;
  error: string | null;
};

/** Plays one loaded audiobook; must be closed before another one uses the element. */
export type Player = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PlayerSnapshot;
  /** Must be called from a user gesture: browsers only then allow audio to start. */
  play: () => void;
  pause: () => void;
  seekToUnit: (unitIndex: number) => void;
  seekTo: (positionMilliseconds: number) => void;
  close: () => void;
};

const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;
const MEDIA_ERROR_MESSAGE = "Audio could not be played. Press Play to try again.";
const MEDIA_EVENT_TYPES = [
  "loadedmetadata",
  "durationchange",
  "play",
  "playing",
  "waiting",
  "pause",
  "seeked",
  "timeupdate",
  "ended",
  "error",
] as const;

/**
 * Plays a loaded audiobook's narration track on the host's one `<audio>` element.
 *
 * The element is the only playback state: the snapshot is read from it whenever it fires a media
 * event. The player adds what the element cannot hold: a position to apply once the track's
 * metadata is loaded, the save cadence, and failures of `play()` and saves.
 */
export class NarrationTrackPlayer implements Player {
  private readonly session: PlaybackSession;
  private readonly element: NarrationAudioElement;
  private readonly listeners = new Set<() => void>();
  /** Where to seek once metadata is loaded; the element cannot seek before. */
  private pendingPositionMilliseconds: number | null;
  private failure: string | null = null;
  private isClosed = false;
  private snapshot: PlayerSnapshot;

  constructor(session: PlaybackSession, element: NarrationAudioElement) {
    this.session = session;
    this.element = element;
    this.pendingPositionMilliseconds = session.initialPositionMilliseconds;

    for (const type of MEDIA_EVENT_TYPES) {
      element.addEventListener(type, this.handleMediaEvent);
    }
    // Setting the source starts loading its metadata and resets the element to the start.
    element.src = session.audiobook.narrationTrack.url;
    this.snapshot = this.readSnapshot();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  play = () => {
    this.failure = null;
    // A failed load stays failed; loading the track again resumes where playback stopped.
    if (this.element.error) {
      this.pendingPositionMilliseconds = this.readPosition();
      this.element.load();
    }

    // Called before anything is awaited: Safari refuses audio started after an await.
    const playing = this.element.play();
    this.publish();
    playing.catch((error: unknown) => {
      // A pause or a new source interrupts a pending start; that is no failure.
      if (this.isClosed || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      this.failure = MEDIA_ERROR_MESSAGE;
      this.publish();
    });
  };

  pause = () => {
    this.element.pause();
  };

  seekToUnit = (unitIndex: number) => {
    const startMilliseconds = this.session.timeline.startMilliseconds[unitIndex];
    if (startMilliseconds === undefined) {
      throw new Error(`Audiobook ${this.session.conversionId} has no unit ${unitIndex}.`);
    }

    this.seekTo(startMilliseconds);
  };

  seekTo = (positionMilliseconds: number) => {
    const position = clampToTimeline(this.session.timeline, positionMilliseconds);
    if (this.element.readyState < HAVE_METADATA) {
      this.pendingPositionMilliseconds = position;
    } else {
      this.element.currentTime = position / 1_000;
    }

    this.save("now", position);
    this.publish();
  };

  /** Saves the position and releases the element, paused, for the host to reuse or empty. */
  close = () => {
    if (this.isClosed) {
      return;
    }

    this.save("now", this.readPosition());
    this.isClosed = true;
    for (const type of MEDIA_EVENT_TYPES) {
      this.element.removeEventListener(type, this.handleMediaEvent);
    }
    this.element.pause();
    this.listeners.clear();
  };

  private handleMediaEvent = (event: Event) => {
    const { element } = this;

    switch (event.type) {
      case "loadedmetadata": {
        this.applyPendingPosition();
        break;
      }
      case "timeupdate": {
        // While seeking, the time reports where the seek started, not a listening position.
        if (!element.seeking && !element.paused) {
          this.save("if-due", this.readPosition());
        }
        break;
      }
      case "pause": {
        // Reaching the end also pauses; `ended` handles that.
        if (element.paused && !element.ended) {
          this.save("now", this.readPosition());
        }
        break;
      }
      case "ended": {
        // A finished audiobook starts over the next time.
        element.currentTime = 0;
        this.save("now", 0);
        break;
      }
    }

    this.publish();
  };

  private applyPendingPosition() {
    const position = this.pendingPositionMilliseconds;
    this.pendingPositionMilliseconds = null;
    if (position === null || position === this.element.currentTime * 1_000) {
      return;
    }

    this.element.currentTime = position / 1_000;
  }

  private readPosition() {
    return this.pendingPositionMilliseconds ?? Math.round(this.element.currentTime * 1_000);
  }

  private save(when: "now" | "if-due", positionMilliseconds: number) {
    const save =
      when === "now"
        ? this.session.save(positionMilliseconds)
        : this.session.saveIfDue(positionMilliseconds);
    save.catch((error: unknown) => {
      if (this.isClosed) {
        return;
      }
      this.failure =
        error instanceof Error ? error.message : "Listening position could not be saved.";
      this.publish();
    });
  }

  private readSnapshot(): PlayerSnapshot {
    const { element } = this;
    const positionMilliseconds = this.readPosition();
    const isPlaying = !element.paused;

    return {
      currentUnitIndex: findUnitIndexAt(this.session.timeline, positionMilliseconds),
      positionMilliseconds,
      // The track's listed duration stands in until the element read the file's own.
      durationMilliseconds:
        Number.isFinite(element.duration) && element.duration > 0
          ? Math.round(element.duration * 1_000)
          : this.session.timeline.durationMilliseconds,
      isPlaying,
      isBuffering: isPlaying && element.readyState < HAVE_FUTURE_DATA,
      error: element.error ? MEDIA_ERROR_MESSAGE : this.failure,
    };
  }

  /**
   * Replaces the snapshot only when a reported value changed. Time updates arrive several times a
   * second, and React's `useSyncExternalStore` re-renders whenever `getSnapshot` returns a new
   * object.
   */
  private publish() {
    if (this.isClosed) {
      return;
    }

    const next = this.readSnapshot();
    if (isSameSnapshot(next, this.snapshot)) {
      return;
    }

    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function isSameSnapshot(left: PlayerSnapshot, right: PlayerSnapshot) {
  return (
    left.currentUnitIndex === right.currentUnitIndex &&
    left.positionMilliseconds === right.positionMilliseconds &&
    left.durationMilliseconds === right.durationMilliseconds &&
    left.isPlaying === right.isPlaying &&
    left.isBuffering === right.isBuffering &&
    left.error === right.error
  );
}
