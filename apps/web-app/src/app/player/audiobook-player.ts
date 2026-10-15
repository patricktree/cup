import {
  findTimelineEntryIndex,
  locateTimelinePosition,
} from "#src/app/player/audiobook-timeline.ts";
import type { PlaybackSession } from "#src/app/player/playback-session.ts";
import type { PlayerSnapshot } from "#src/platform/player.ts";

/** What the browser engine needs from the loaded audiobook's playback session. */
export type AudiobookPlayerSession = Pick<
  PlaybackSession,
  | "timeline"
  | "initialLocation"
  | "reportedPositionAt"
  | "adjacentUnitIndex"
  | "authorizeMedia"
  | "save"
  | "saveIfDue"
>;

/** The members of an audio element the engine uses. */
export type AudiobookAudioElement = Pick<
  HTMLAudioElement,
  | "addEventListener"
  | "removeEventListener"
  | "play"
  | "pause"
  | "load"
  | "removeAttribute"
  | "src"
  | "currentTime"
  | "duration"
  | "muted"
  | "paused"
  | "ended"
  | "seeking"
>;

/** The browser facilities the engine plays with, supplied by its caller so tests can fake them. */
export type AudiobookPlayerEnvironment = {
  /** Creates one of the two audio elements, configured to send media credentials. */
  createAudioElement: () => AudiobookAudioElement;
  /** A short same-origin silence that unlocks an element which has no segment loaded yet. */
  silenceUrl: string;
};

/**
 * Plays an audiobook's audio segments as one continuous timeline.
 *
 * Two audio elements alternate: one plays while the other preloads the following segment, so a
 * segment boundary needs no loading pause. See ADR 0008.
 */
export class AudiobookPlayer {
  private readonly session: AudiobookPlayerSession;
  private readonly environment: AudiobookPlayerEnvironment;
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot;

  private elements: [AudiobookAudioElement, AudiobookAudioElement] | null = null;
  private activeElementIndex: 0 | 1 = 0;
  private readonly loadedEntryIndexes: [number | null, number | null] = [null, null];
  private entryIndex: number;
  private offsetMilliseconds: number;
  private readonly hasUnlockedElement: [boolean, boolean] = [false, false];
  private removeElementListeners: (() => void) | null = null;
  // Media requests need authorization, which is established asynchronously when the player opens.
  private initialAuthorization: Promise<void> = Promise.resolve();
  private isAwaitingInitialAuthorization = false;

  constructor(session: AudiobookPlayerSession, environment: AudiobookPlayerEnvironment) {
    this.session = session;
    this.environment = environment;
    this.entryIndex = session.initialLocation.entryIndex;
    this.offsetMilliseconds = session.initialLocation.offsetMilliseconds;
    this.snapshot = {
      ...this.describePosition(),
      durationMilliseconds: session.timeline.durationMilliseconds,
      isPlaying: false,
      isBuffering: false,
      error: null,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  open = () => {
    if (this.elements) {
      return;
    }

    const elements: [AudiobookAudioElement, AudiobookAudioElement] = [
      this.environment.createAudioElement(),
      this.environment.createAudioElement(),
    ];
    this.elements = elements;
    this.activeElementIndex = 0;

    const removers = elements.flatMap((element, elementIndex) => {
      // Ignores the standby element and an element that only plays the unlocking silence.
      const whenActive = (handler: () => void) => () => {
        if (
          this.elements !== null &&
          this.activeElementIndex === elementIndex &&
          this.loadedEntryIndexes[elementIndex] === this.entryIndex
        ) {
          handler();
        }
      };
      const handlers = {
        ended: whenActive(() => this.onEnded()),
        timeupdate: whenActive(() => this.onTimeUpdate(element)),
        waiting: whenActive(() => {
          if (this.snapshot.isPlaying) {
            this.update({ isBuffering: true });
          }
        }),
        playing: whenActive(() => this.update({ isBuffering: false })),
        pause: whenActive(() => this.onElementPaused(element)),
        error: () => this.onMediaError(elementIndex === 0 ? 0 : 1),
      };

      return Object.entries(handlers).map(([type, handler]) => {
        element.addEventListener(type, handler);
        return () => element.removeEventListener(type, handler);
      });
    });
    this.removeElementListeners = () => {
      for (const remove of removers) {
        remove();
      }
    };

    if (this.session.timeline.entries.length === 0) {
      return;
    }
    this.isAwaitingInitialAuthorization = true;
    this.initialAuthorization = this.session
      .authorizeMedia()
      .catch(() => {
        // An unauthorized segment fails to load, which is reported once playback is requested.
      })
      .then(() => {
        if (this.elements !== elements) {
          return undefined;
        }
        this.isAwaitingInitialAuthorization = false;
        this.load(this.activeElementIndex, this.entryIndex, this.offsetMilliseconds);
        this.preloadFollowingEntry();
        return undefined;
      });
  };

  close = () => {
    if (!this.elements) {
      return;
    }

    this.save();
    this.removeElementListeners?.();
    for (const element of this.elements) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.elements = null;
    this.loadedEntryIndexes.fill(null);
    this.isAwaitingInitialAuthorization = false;
    this.hasUnlockedElement.fill(false);
    this.update({ isPlaying: false, isBuffering: false });
  };

  /** Must be called from a user gesture: browsers only then allow both elements to start. */
  play = () => {
    if (this.snapshot.isPlaying || !this.elements || this.session.timeline.entries.length === 0) {
      return;
    }

    this.update({ isPlaying: true, error: null });
    // The active element is unlocked by its own start below unless it has nothing to play yet.
    if (this.isAwaitingInitialAuthorization) {
      this.unlockElement(this.activeElementIndex);
    }
    this.unlockElement(this.standbyElementIndex);
    if (this.isAwaitingInitialAuthorization) {
      // Pressed before the initial authorization finished; start as soon as media may be requested.
      void this.initialAuthorization.then(() => {
        if (this.snapshot.isPlaying) {
          this.startActiveElement();
        }
        return undefined;
      });
      return;
    }
    this.startActiveElement();
  };

  /** Moves by segments with audio, so a skipped segment is never a destination. */
  skip = (direction: 1 | -1) => {
    const unitIndex = this.session.adjacentUnitIndex(this.snapshot.currentUnitIndex, direction);
    if (unitIndex !== undefined) {
      this.seekToUnit(unitIndex);
    }
  };

  pause = () => {
    if (!this.snapshot.isPlaying) {
      return;
    }

    this.update({ isPlaying: false, isBuffering: false });
    this.elements?.[this.activeElementIndex].pause();
    this.save();
  };

  /** Seeks to the start of a unit, or of the next unit with audio when it was skipped. */
  seekToUnit = (unitIndex: number) => {
    const entryIndex = findTimelineEntryIndex(this.session.timeline, unitIndex);
    if (entryIndex < 0) {
      return;
    }

    this.moveTo(entryIndex, 0);
  };

  /** Seeks to a position on the whole-audiobook timeline. */
  seekTo = (positionMilliseconds: number) => {
    const location = locateTimelinePosition(this.session.timeline, positionMilliseconds);
    if (!location) {
      return;
    }

    this.moveTo(location.entryIndex, location.offsetMilliseconds);
  };

  private get standbyElementIndex(): 0 | 1 {
    return this.activeElementIndex === 0 ? 1 : 0;
  }

  private update(value: Partial<PlayerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private describePosition() {
    return this.session.reportedPositionAt({
      entryIndex: this.entryIndex,
      offsetMilliseconds: this.offsetMilliseconds,
    });
  }

  private moveTo(entryIndex: number, offsetMilliseconds: number) {
    const elements = this.elements;
    if (!elements) {
      return;
    }

    if (this.isAwaitingInitialAuthorization) {
      // Nothing is loaded yet; the initial load picks up this position.
      this.entryIndex = entryIndex;
      this.offsetMilliseconds = offsetMilliseconds;
      this.update({ ...this.describePosition(), error: null });
      this.save();
      return;
    }

    const standbyElementIndex = this.standbyElementIndex;
    elements[this.activeElementIndex].pause();
    this.entryIndex = entryIndex;
    this.offsetMilliseconds = offsetMilliseconds;

    if (this.loadedEntryIndexes[this.activeElementIndex] === entryIndex) {
      elements[this.activeElementIndex].currentTime = offsetMilliseconds / 1_000;
    } else if (this.loadedEntryIndexes[standbyElementIndex] === entryIndex) {
      this.activeElementIndex = standbyElementIndex;
      elements[standbyElementIndex].currentTime = offsetMilliseconds / 1_000;
    } else {
      // Replacing the source of the element the media controls follow makes Android browsers
      // drop and recreate their notification, so the segment starts on the standby element.
      this.activeElementIndex = standbyElementIndex;
      this.load(standbyElementIndex, entryIndex, offsetMilliseconds);
    }

    this.update({ ...this.describePosition(), error: null });
    this.save();
    this.preloadFollowingEntry();
    if (this.snapshot.isPlaying) {
      this.startActiveElement();
    }
  }

  private load(elementIndex: 0 | 1, entryIndex: number, offsetMilliseconds = 0) {
    const element = this.elements?.[elementIndex];
    const entry = this.session.timeline.entries[entryIndex];
    if (!element || !entry) {
      return;
    }

    this.loadedEntryIndexes[elementIndex] = entryIndex;
    element.src = entry.url;
    if (offsetMilliseconds === 0) {
      return;
    }

    element.addEventListener(
      "loadedmetadata",
      () => {
        if (this.loadedEntryIndexes[elementIndex] !== entryIndex) {
          return;
        }
        element.currentTime = Math.min(
          offsetMilliseconds / 1_000,
          Math.max(0, element.duration - 0.01),
        );
      },
      { once: true },
    );
  }

  private preloadFollowingEntry() {
    const followingEntryIndex = this.entryIndex + 1;
    const standbyElementIndex = this.standbyElementIndex;
    if (
      followingEntryIndex >= this.session.timeline.entries.length ||
      this.loadedEntryIndexes[standbyElementIndex] === followingEntryIndex
    ) {
      return;
    }

    // Media authorization can expire during a long audiobook; renew it ahead of each request.
    void this.session
      .authorizeMedia()
      .then(() => {
        const isStillFollowing =
          this.entryIndex + 1 === followingEntryIndex &&
          this.activeElementIndex !== standbyElementIndex;
        if (isStillFollowing) {
          this.load(standbyElementIndex, followingEntryIndex);
        }
        return undefined;
      })
      .catch(() => {
        // The segment is loaded when it becomes active, where a failure is reported.
      });
  }

  /**
   * Mobile Safari lets an audio element start only once it was played within a user gesture.
   * Starting both elements muted inside the Play gesture allows every later start, including
   * boundary swaps. An element without a segment plays a short silence for this.
   */
  private unlockElement(elementIndex: 0 | 1) {
    const element = this.elements?.[elementIndex];
    if (!element || this.hasUnlockedElement[elementIndex]) {
      return;
    }

    this.hasUnlockedElement[elementIndex] = true;
    if (this.loadedEntryIndexes[elementIndex] === null) {
      element.src = this.environment.silenceUrl;
    }
    element.muted = true;
    void element
      .play()
      .then(() => {
        const isPlayingItsSegment =
          elementIndex === this.activeElementIndex &&
          this.loadedEntryIndexes[elementIndex] !== null;
        if (isPlayingItsSegment) {
          return undefined;
        }
        element.pause();
        if (this.loadedEntryIndexes[elementIndex] !== null) {
          element.currentTime = 0;
        }
        return undefined;
      })
      .catch((error: unknown) => {
        // Loading a segment interrupts the silence after the gesture already unlocked the element.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        this.hasUnlockedElement[elementIndex] = false;
      })
      .finally(() => {
        element.muted = false;
      });
  }

  private startActiveElement() {
    const element = this.elements?.[this.activeElementIndex];
    if (!element) {
      return;
    }

    if (this.loadedEntryIndexes[this.activeElementIndex] !== this.entryIndex) {
      this.load(this.activeElementIndex, this.entryIndex, this.offsetMilliseconds);
    }

    element.muted = false;
    void element.play().catch((error: unknown) => {
      // A newer seek or pause interrupts this start; only a genuine failure is reported.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      this.update({
        isPlaying: false,
        isBuffering: false,
        error: error instanceof Error ? error.message : "Audio could not be played.",
      });
    });
  }

  private onEnded() {
    if (!this.snapshot.isPlaying) {
      return;
    }

    const followingEntryIndex = this.entryIndex + 1;
    if (followingEntryIndex >= this.session.timeline.entries.length) {
      this.entryIndex = 0;
      this.offsetMilliseconds = 0;
      this.update({ ...this.describePosition(), isPlaying: false, isBuffering: false });
      this.load(this.activeElementIndex, 0);
      this.save();
      this.preloadFollowingEntry();
      return;
    }

    this.activeElementIndex = this.standbyElementIndex;
    this.entryIndex = followingEntryIndex;
    this.offsetMilliseconds = 0;
    this.update(this.describePosition());
    this.startActiveElement();
    this.preloadFollowingEntry();
  }

  private onTimeUpdate(element: AudiobookAudioElement) {
    if (this.loadedEntryIndexes[this.activeElementIndex] !== this.entryIndex || element.seeking) {
      return;
    }

    this.offsetMilliseconds = element.currentTime * 1_000;
    this.update(this.describePosition());
    this.save("if-due");
  }

  /** Follows pauses made outside the player, such as an audio interruption by the system. */
  private onElementPaused(element: AudiobookAudioElement) {
    // A seek pauses and restarts the element; by the time this event arrives it plays again.
    if (this.snapshot.isPlaying && !this.snapshot.isBuffering && element.paused && !element.ended) {
      this.pause();
    }
  }

  private onMediaError(elementIndex: 0 | 1) {
    // A preloaded segment that failed is loaded again when playback reaches it.
    this.loadedEntryIndexes[elementIndex] = null;
    if (elementIndex !== this.activeElementIndex || !this.snapshot.isPlaying) {
      return;
    }

    this.update({
      isPlaying: false,
      isBuffering: false,
      error: "Audio could not be played. Press Play to try again.",
    });
  }

  private save(when: "now" | "if-due" = "now") {
    const reported = this.describePosition();
    const save = when === "now" ? this.session.save(reported) : this.session.saveIfDue(reported);
    void save.catch((error: unknown) => {
      if (this.elements) {
        this.update({
          error: error instanceof Error ? error.message : "Listening position could not be saved.",
        });
      }
    });
  }
}
