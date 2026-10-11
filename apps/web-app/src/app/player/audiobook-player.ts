import type { Audiobook, PlaybackPosition } from "@cup/web-app-api.routes";

import {
  createAudiobookTimeline,
  findTimelineEntryIndex,
  locateTimelinePosition,
  type AudiobookTimeline,
} from "#src/app/player/audiobook-timeline.js";
import silenceUrl from "#src/app/player/silence.wav?no-inline";
import {
  getResourceAccountSession,
  refreshPlaybackAuthorization,
} from "#src/auth/account-session.js";
import { savePlaybackPosition } from "#src/data-fetching/reader.js";

/** A conversion whose narration document is prepared, whatever the state of its audio. */
export type PreparedAudiobook = Extract<Audiobook, { title: string }>;
/** An audiobook whose every segment has audio or a final failure. */
export type PlayableAudiobook = Extract<Audiobook, { status: "ready" }>;

export type PlayerSnapshot = {
  currentUnitIndex: number;
  /** Position and duration on the whole-audiobook timeline. */
  positionMilliseconds: number;
  durationMilliseconds: number;
  isPlaying: boolean;
  isBuffering: boolean;
  error: string | null;
};

export type PlayerServices = {
  save(position: PlaybackPosition): Promise<void>;
  authorize(): Promise<void>;
  createAudioElement(): HTMLAudioElement;
};

const SAVE_INTERVAL_MILLISECONDS = 5_000;

/**
 * Plays an audiobook's audio segments as one continuous timeline.
 *
 * Two audio elements alternate: one plays while the other preloads the following segment, so a
 * segment boundary needs no loading pause. See ADR 0008.
 */
export class AudiobookPlayer {
  private readonly audiobook: PlayableAudiobook;
  private readonly services: PlayerServices;
  private readonly timeline: AudiobookTimeline;
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot;

  private elements: [HTMLAudioElement, HTMLAudioElement] | null = null;
  private activeElementIndex: 0 | 1 = 0;
  private readonly loadedEntryIndexes: [number | null, number | null] = [null, null];
  private entryIndex: number;
  private offsetMilliseconds: number;
  private readonly hasUnlockedElement: [boolean, boolean] = [false, false];
  private lastSavedAt = 0;
  private saveChain: Promise<void> = Promise.resolve();
  private removeElementListeners: (() => void) | null = null;
  // Media requests need authorization, which is established asynchronously when the player opens.
  private initialAuthorization: Promise<void> = Promise.resolve();
  private isAwaitingInitialAuthorization = false;

  constructor(
    audiobook: PlayableAudiobook,
    position: PlaybackPosition | null,
    services: PlayerServices,
  ) {
    this.audiobook = audiobook;
    this.services = services;
    this.timeline = createAudiobookTimeline(audiobook.segments);

    const positionUnitIndex = position
      ? audiobook.narrationDocument.synchronizationUnits.findIndex(
          (unit) => unit.id === position.synchronizationUnitId,
        )
      : -1;
    const restoredEntryIndex =
      positionUnitIndex < 0 ? -1 : findTimelineEntryIndex(this.timeline, positionUnitIndex);
    const isRestoredUnitPlayable =
      this.timeline.entries[restoredEntryIndex]?.unitIndex === positionUnitIndex;

    this.entryIndex = Math.max(0, restoredEntryIndex);
    // A skipped unit resumes at the start of the next one with audio.
    this.offsetMilliseconds = isRestoredUnitPlayable ? (position?.offsetMilliseconds ?? 0) : 0;
    this.snapshot = {
      ...this.describePosition(),
      durationMilliseconds: this.timeline.durationMilliseconds,
      isPlaying: false,
      isBuffering: false,
      error: null,
    };
  }

  static forConversion(
    this: void,
    conversionId: string,
    audiobook: PlayableAudiobook,
    position: PlaybackPosition | null,
    subject: string | null,
  ) {
    return new AudiobookPlayer(audiobook, position, {
      save: (value) => savePlaybackPosition(conversionId, value, subject),
      authorize: async () => {
        const session = await getResourceAccountSession();
        if (subject && session?.user.id !== subject)
          throw new Error("Sign in again to continue playback.");
        await refreshPlaybackAuthorization(session);
      },
      createAudioElement: () => {
        const element = new Audio();
        element.preload = "auto";
        element.crossOrigin = "use-credentials";
        return element;
      },
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  open = () => {
    if (this.elements) return;

    const elements: [HTMLAudioElement, HTMLAudioElement] = [
      this.services.createAudioElement(),
      this.services.createAudioElement(),
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
        )
          handler();
      };
      const handlers = {
        ended: whenActive(() => this.onEnded()),
        timeupdate: whenActive(() => this.onTimeUpdate(element)),
        waiting: whenActive(() => {
          if (this.snapshot.isPlaying) this.update({ isBuffering: true });
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
      for (const remove of removers) remove();
    };

    if (this.timeline.entries.length === 0) return;
    this.isAwaitingInitialAuthorization = true;
    this.initialAuthorization = this.services
      .authorize()
      .catch(() => {
        // An unauthorized segment fails to load, which is reported once playback is requested.
      })
      .then(() => {
        if (this.elements !== elements) return undefined;
        this.isAwaitingInitialAuthorization = false;
        this.load(this.activeElementIndex, this.entryIndex, this.offsetMilliseconds);
        this.preloadFollowingEntry();
        return undefined;
      });
  };

  close = () => {
    if (!this.elements) return;

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
    if (this.snapshot.isPlaying || !this.elements || this.timeline.entries.length === 0) return;

    this.update({ isPlaying: true, error: null });
    // The active element is unlocked by its own start below unless it has nothing to play yet.
    if (this.isAwaitingInitialAuthorization) this.unlockElement(this.activeElementIndex);
    this.unlockElement(this.standbyElementIndex);
    if (this.isAwaitingInitialAuthorization) {
      // Pressed before the initial authorization finished; start as soon as media may be requested.
      void this.initialAuthorization.then(() => {
        if (this.snapshot.isPlaying) this.startActiveElement();
        return undefined;
      });
      return;
    }
    this.startActiveElement();
  };

  /** Moves by segments with audio, so a skipped segment is never a destination. */
  skip = (direction: 1 | -1) => {
    const entryIndex = this.entryIndex + direction;
    if (entryIndex < 0 || entryIndex >= this.timeline.entries.length) return;

    this.moveTo(entryIndex, 0);
  };

  pause = () => {
    if (!this.snapshot.isPlaying) return;

    this.update({ isPlaying: false, isBuffering: false });
    this.elements?.[this.activeElementIndex].pause();
    this.save();
  };

  /** Seeks to the start of a unit, or of the next unit with audio when it was skipped. */
  seekToUnit = (unitIndex: number) => {
    const entryIndex = findTimelineEntryIndex(this.timeline, unitIndex);
    if (entryIndex < 0) return;

    this.moveTo(entryIndex, 0);
  };

  /** Seeks to a position on the whole-audiobook timeline. */
  seekTo = (positionMilliseconds: number) => {
    const location = locateTimelinePosition(this.timeline, positionMilliseconds);
    if (!location) return;

    this.moveTo(location.entryIndex, location.offsetMilliseconds);
  };

  private get standbyElementIndex(): 0 | 1 {
    return this.activeElementIndex === 0 ? 1 : 0;
  }

  private update(value: Partial<PlayerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    for (const listener of this.listeners) listener();
  }

  private describePosition() {
    const entry = this.timeline.entries[this.entryIndex];
    return {
      currentUnitIndex: entry?.unitIndex ?? 0,
      positionMilliseconds: (entry?.startMilliseconds ?? 0) + this.offsetMilliseconds,
    };
  }

  private moveTo(entryIndex: number, offsetMilliseconds: number) {
    const elements = this.elements;
    if (!elements) return;

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
      this.load(this.activeElementIndex, entryIndex, offsetMilliseconds);
    }

    this.update({ ...this.describePosition(), error: null });
    this.save();
    this.preloadFollowingEntry();
    if (this.snapshot.isPlaying) this.startActiveElement();
  }

  private load(elementIndex: 0 | 1, entryIndex: number, offsetMilliseconds = 0) {
    const element = this.elements?.[elementIndex];
    const entry = this.timeline.entries[entryIndex];
    if (!element || !entry) return;

    this.loadedEntryIndexes[elementIndex] = entryIndex;
    element.src = entry.url;
    if (offsetMilliseconds === 0) return;

    element.addEventListener(
      "loadedmetadata",
      () => {
        if (this.loadedEntryIndexes[elementIndex] !== entryIndex) return;
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
      followingEntryIndex >= this.timeline.entries.length ||
      this.loadedEntryIndexes[standbyElementIndex] === followingEntryIndex
    )
      return;

    // Media authorization can expire during a long audiobook; renew it ahead of each request.
    void this.services
      .authorize()
      .then(() => {
        const isStillFollowing =
          this.entryIndex + 1 === followingEntryIndex &&
          this.activeElementIndex !== standbyElementIndex;
        if (isStillFollowing) this.load(standbyElementIndex, followingEntryIndex);
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
    if (!element || this.hasUnlockedElement[elementIndex]) return;

    this.hasUnlockedElement[elementIndex] = true;
    if (this.loadedEntryIndexes[elementIndex] === null) element.src = silenceUrl;
    element.muted = true;
    void element
      .play()
      .then(() => {
        const isPlayingItsSegment =
          elementIndex === this.activeElementIndex &&
          this.loadedEntryIndexes[elementIndex] !== null;
        if (isPlayingItsSegment) return undefined;
        element.pause();
        if (this.loadedEntryIndexes[elementIndex] !== null) element.currentTime = 0;
        return undefined;
      })
      .catch((error: unknown) => {
        // Loading a segment interrupts the silence after the gesture already unlocked the element.
        if (error instanceof DOMException && error.name === "AbortError") return;
        this.hasUnlockedElement[elementIndex] = false;
      })
      .finally(() => {
        element.muted = false;
      });
  }

  private startActiveElement() {
    const element = this.elements?.[this.activeElementIndex];
    if (!element) return;

    if (this.loadedEntryIndexes[this.activeElementIndex] !== this.entryIndex)
      this.load(this.activeElementIndex, this.entryIndex, this.offsetMilliseconds);

    element.muted = false;
    void element.play().catch((error: unknown) => {
      // A newer seek or pause interrupts this start; only a genuine failure is reported.
      if (error instanceof DOMException && error.name === "AbortError") return;
      this.update({
        isPlaying: false,
        isBuffering: false,
        error: error instanceof Error ? error.message : "Audio could not be played.",
      });
    });
  }

  private onEnded() {
    if (!this.snapshot.isPlaying) return;

    const followingEntryIndex = this.entryIndex + 1;
    if (followingEntryIndex >= this.timeline.entries.length) {
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

  private onTimeUpdate(element: HTMLAudioElement) {
    if (this.loadedEntryIndexes[this.activeElementIndex] !== this.entryIndex || element.seeking)
      return;

    this.offsetMilliseconds = element.currentTime * 1_000;
    this.update(this.describePosition());
    if (performance.now() - this.lastSavedAt >= SAVE_INTERVAL_MILLISECONDS) this.save();
  }

  /** Follows pauses made outside the player, such as an audio interruption by the system. */
  private onElementPaused(element: HTMLAudioElement) {
    // A seek pauses and restarts the element; by the time this event arrives it plays again.
    if (this.snapshot.isPlaying && !this.snapshot.isBuffering && element.paused && !element.ended)
      this.pause();
  }

  private onMediaError(elementIndex: 0 | 1) {
    // A preloaded segment that failed is loaded again when playback reaches it.
    this.loadedEntryIndexes[elementIndex] = null;
    if (elementIndex !== this.activeElementIndex || !this.snapshot.isPlaying) return;

    this.update({
      isPlaying: false,
      isBuffering: false,
      error: "Audio could not be played. Press Play to try again.",
    });
  }

  private save() {
    const entry = this.timeline.entries[this.entryIndex];
    const unit = entry && this.audiobook.narrationDocument.synchronizationUnits[entry.unitIndex];
    if (!unit) return;

    const position = {
      synchronizationUnitId: unit.id,
      offsetMilliseconds: this.offsetMilliseconds,
    };
    this.lastSavedAt = performance.now();
    this.saveChain = this.saveChain.catch(() => undefined).then(() => this.services.save(position));
    void this.saveChain.catch((error: unknown) => {
      if (this.elements)
        this.update({
          error: error instanceof Error ? error.message : "Listening position could not be saved.",
        });
    });
  }
}
