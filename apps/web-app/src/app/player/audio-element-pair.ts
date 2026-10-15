import type { AudiobookTimeline } from "#src/app/player/audiobook-timeline.ts";
import type { TimelineLocation } from "#src/platform/player.ts";

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

export type ElementIndex = 0 | 1;

/** Media events of an audio element, as machine events naming the element that fired them. */
export const MEDIA_EVENT_TYPES = {
  ended: "MEDIA.ENDED",
  timeupdate: "MEDIA.TIME_UPDATE",
  waiting: "MEDIA.WAITING",
  playing: "MEDIA.PLAYING",
  pause: "MEDIA.PAUSE",
  error: "MEDIA.ERROR",
} as const;

export type MediaEvent = {
  type: (typeof MEDIA_EVENT_TYPES)[keyof typeof MEDIA_EVENT_TYPES];
  elementIndex: ElementIndex;
};

/**
 * The browser engine's two audio elements and which segment each holds. The active element plays
 * the location; the standby element preloads the following segment.
 *
 * It only performs element work. The [machine](./audiobook-player-machine.ts) decides when.
 */
export class AudioElementPair {
  private readonly environment: AudiobookPlayerEnvironment;
  private readonly timeline: AudiobookTimeline;
  private readonly onMediaEvent: (event: MediaEvent) => void;
  private attached: {
    elements: [AudiobookAudioElement, AudiobookAudioElement];
    removeListeners: () => void;
  } | null = null;
  private activeIndex: ElementIndex = 0;
  private readonly loadedEntryIndexes: [number | null, number | null] = [null, null];
  private readonly hasUnlockedElement: [boolean, boolean] = [false, false];

  constructor(
    environment: AudiobookPlayerEnvironment,
    timeline: AudiobookTimeline,
    onMediaEvent: (event: MediaEvent) => void,
  ) {
    this.environment = environment;
    this.timeline = timeline;
    this.onMediaEvent = onMediaEvent;
  }

  get standbyIndex(): ElementIndex {
    return this.activeIndex === 0 ? 1 : 0;
  }

  get active() {
    return this.elementAt(this.activeIndex);
  }

  /** Creates both elements and forwards their media events. */
  attach() {
    const elements: [AudiobookAudioElement, AudiobookAudioElement] = [
      this.environment.createAudioElement(),
      this.environment.createAudioElement(),
    ];
    const removers = elements.flatMap((element, index) => {
      const elementIndex: ElementIndex = index === 0 ? 0 : 1;
      return Object.entries(MEDIA_EVENT_TYPES).map(([domType, type]) => {
        const listener = () => this.onMediaEvent({ type, elementIndex });
        element.addEventListener(domType, listener);
        return () => element.removeEventListener(domType, listener);
      });
    });

    this.attached = {
      elements,
      removeListeners: () => {
        for (const remove of removers) {
          remove();
        }
      },
    };
    this.activeIndex = 0;
  }

  /** Stops both elements, drops their sources, and forgets them. */
  release() {
    const { elements, removeListeners } = this.requireAttached();
    removeListeners();
    for (const element of elements) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }

    this.attached = null;
    this.loadedEntryIndexes.fill(null);
    this.hasUnlockedElement.fill(false);
  }

  elementAt(elementIndex: ElementIndex) {
    return this.requireAttached().elements[elementIndex];
  }

  isActive(elementIndex: ElementIndex) {
    return this.activeIndex === elementIndex;
  }

  loadedEntryIndexOf(elementIndex: ElementIndex) {
    return this.loadedEntryIndexes[elementIndex];
  }

  /** Whether an element is the active one and holds the entry; the other plays silence or preloads. */
  holdsActiveSegment(elementIndex: ElementIndex, entryIndex: number) {
    return this.isActive(elementIndex) && this.loadedEntryIndexes[elementIndex] === entryIndex;
  }

  /** Makes the standby element active, as at a segment boundary. */
  activateStandby() {
    this.activeIndex = this.standbyIndex;
  }

  loadActive(location: TimelineLocation) {
    this.load(this.activeIndex, location.entryIndex, location.offsetMilliseconds);
  }

  load(elementIndex: ElementIndex, entryIndex: number, offsetMilliseconds = 0) {
    const element = this.elementAt(elementIndex);
    const entry = this.timeline.entries[entryIndex];
    if (!entry) {
      throw new Error(`Timeline entry ${entryIndex} does not exist.`);
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

  /** Marks an element's segment as not loaded, so it is loaded again when playback reaches it. */
  forget(elementIndex: ElementIndex) {
    this.loadedEntryIndexes[elementIndex] = null;
  }

  /** Makes the element holding a location active, seeking within it, or loads it on standby first. */
  moveTo(location: TimelineLocation) {
    const standbyIndex = this.standbyIndex;
    this.active.pause();

    if (this.loadedEntryIndexes[this.activeIndex] === location.entryIndex) {
      this.active.currentTime = location.offsetMilliseconds / 1_000;
    } else if (this.loadedEntryIndexes[standbyIndex] === location.entryIndex) {
      this.activeIndex = standbyIndex;
      this.active.currentTime = location.offsetMilliseconds / 1_000;
    } else {
      // Replacing the source of the element the media controls follow makes Android browsers
      // drop and recreate their notification, so the segment starts on the standby element.
      this.activeIndex = standbyIndex;
      this.load(standbyIndex, location.entryIndex, location.offsetMilliseconds);
    }
  }

  unlockActive() {
    this.unlock(this.activeIndex);
  }

  unlockStandby() {
    this.unlock(this.standbyIndex);
  }

  /**
   * Mobile Safari lets an audio element start only once it was played within a user gesture.
   * Starting both elements muted inside the Play gesture allows every later start, including
   * boundary swaps. An element without a segment plays a short silence for this.
   */
  private unlock(elementIndex: ElementIndex) {
    const element = this.elementAt(elementIndex);
    if (this.hasUnlockedElement[elementIndex]) {
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
          this.isActive(elementIndex) && this.loadedEntryIndexes[elementIndex] !== null;
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

  /** Starts the active element at a location, loading it there first unless it holds it. */
  start(location: TimelineLocation, onFailure: (message: string) => void) {
    const element = this.active;
    if (this.loadedEntryIndexes[this.activeIndex] !== location.entryIndex) {
      this.loadActive(location);
    }

    element.muted = false;
    void element.play().catch((error: unknown) => {
      // A newer seek or pause interrupts this start; only a genuine failure is reported.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      onFailure(error instanceof Error ? error.message : "Audio could not be played.");
    });
  }

  private requireAttached() {
    if (!this.attached) {
      throw new Error("The audio elements are used while the player is closed.");
    }
    return this.attached;
  }
}
