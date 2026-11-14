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
  /** Seeks by an amount from the current position, back when negative, such as −15 s and +15 s. */
  skipBy: (deltaMilliseconds: number) => void;
  /** Loads the same track from a newly signed URL, keeping the position; plays nothing. */
  replaceTrackUrl: (url: string) => void;
  /** Shows a failure that happened outside the player, until the next Play. */
  showError: (message: string) => void;
  /** Releases the element, saving the position unless told otherwise. */
  close: (position?: PositionOnClose) => void;
};

/** `"discard"` skips saving the position, for a track that is deleted or no longer exists. */
export type PositionOnClose = "save" | "discard";

/** How far the −15 s and +15 s controls skip. */
export const SKIP_MILLISECONDS = 15_000;

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
 * Whether the element plays. A source that fails before playback starts leaves it unpaused, as
 * Chromium follows the HTML spec's media source failure steps, though it plays nothing.
 */
export function isElementPlaying(element: Pick<NarrationAudioElement, "paused" | "error">) {
  return !element.paused && !element.error;
}

/**
 * Whether a seek on the element lands where it asks. WebKit's GStreamer media backend on Linux can
 * fire `loadedmetadata` with a duration of 0 before it has read the track's length; a seek then
 * clamps to that duration, and the backend can settle on a duration of a few milliseconds and end
 * playback at once. A duration above 0 shows the length is known. While the duration is 0, the
 * track plays from the start until the held position is applied.
 */
function canSeek(element: Pick<NarrationAudioElement, "readyState" | "duration">) {
  return element.readyState >= HAVE_METADATA && element.duration > 0;
}

/**
 * Plays a loaded audiobook's narration track on the host's one `<audio>` element.
 *
 * The element is the only playback state: the snapshot is read from it whenever it fires a media
 * event. The player adds what the element cannot hold: a position to apply once the track's
 * duration is known, the save cadence, and failures of `play()`; the session reports failed saves.
 */
export class NarrationTrackPlayer implements Player {
  private readonly session: PlaybackSession;
  private readonly element: NarrationAudioElement;
  private readonly listeners = new Set<() => void>();
  /** Where to seek once the element knows the track's duration; it cannot seek before. */
  private pendingPositionMilliseconds: number | null;
  private failure: string | null = null;
  private readonly unsubscribeSaveFailure: () => void;
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
    this.unsubscribeSaveFailure = session.subscribeSaveFailure(() => this.publish());
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
    if (!canSeek(this.element)) {
      this.pendingPositionMilliseconds = position;
    } else {
      // The element can report its metadata before `loadedmetadata` is dispatched, which must
      // then not apply an earlier seek.
      this.pendingPositionMilliseconds = null;
      this.element.currentTime = position / 1_000;
    }

    this.save("now", position);
    this.publish();
  };

  skipBy = (deltaMilliseconds: number) => {
    this.seekTo(this.readPosition() + deltaMilliseconds);
  };

  replaceTrackUrl = (url: string) => {
    // A new source resets the element to the start and clears a failed load.
    this.pendingPositionMilliseconds = this.readPosition();
    this.element.src = url;
    this.publish();
  };

  showError = (message: string) => {
    this.failure = message;
    this.publish();
  };

  /** Saves the position and releases the element, paused, for the host to reuse or empty. */
  close = (position: PositionOnClose = "save") => {
    if (this.isClosed) {
      return;
    }

    if (position === "save") {
      this.save("now", this.readPosition());
    }
    this.isClosed = true;
    this.unsubscribeSaveFailure();
    // The player owns the session the host created for it; closing stops its save retries.
    this.session.close();
    for (const type of MEDIA_EVENT_TYPES) {
      this.element.removeEventListener(type, this.handleMediaEvent);
    }
    this.element.pause();
    this.listeners.clear();
  };

  private handleMediaEvent = (event: Event) => {
    const { element } = this;

    // WebKit's GStreamer backend corrects a duration of 0 without firing `durationchange`, so any
    // media event, such as the next `timeupdate`, can be the first to find the duration known.
    if (this.pendingPositionMilliseconds !== null && canSeek(element)) {
      this.applyPendingPosition();
    }

    switch (event.type) {
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

  /** The session reports failed saves through `getSaveFailure` and retries them itself. */
  private save(when: "now" | "if-due", positionMilliseconds: number) {
    if (when === "now") {
      void this.session.save(positionMilliseconds);
    } else {
      void this.session.saveIfDue(positionMilliseconds);
    }
  }

  private readSnapshot(): PlayerSnapshot {
    const { element } = this;
    const positionMilliseconds = this.readPosition();
    const isPlaying = isElementPlaying(element);

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
      error:
        this.failure ??
        (element.error ? MEDIA_ERROR_MESSAGE : null) ??
        this.session.getSaveFailure(),
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
