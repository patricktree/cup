import { and, assertEvent, assign, fromPromise, setup, stateIn } from "xstate";

import type { AudiobookTimeline } from "#src/app/player/audiobook-timeline.ts";
import type { PlaybackSession } from "#src/app/player/playback-session.ts";
import type { TimelineLocation } from "#src/platform/player.ts";

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

type ElementIndex = 0 | 1;

/** Media events of an audio element, as machine events naming the element that fired them. */
const MEDIA_EVENT_TYPES = {
  ended: "MEDIA.ENDED",
  timeupdate: "MEDIA.TIME_UPDATE",
  waiting: "MEDIA.WAITING",
  playing: "MEDIA.PLAYING",
  pause: "MEDIA.PAUSE",
  error: "MEDIA.ERROR",
} as const;

type MediaEvent = {
  type: (typeof MEDIA_EVENT_TYPES)[keyof typeof MEDIA_EVENT_TYPES];
  elementIndex: ElementIndex;
};

type AudiobookPlayerEvent =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "SEEK"; location: TimelineLocation }
  | MediaEvent
  /** Media authorization was renewed for preloading an entry into an element. */
  | { type: "PRELOAD_AUTHORIZED"; entryIndex: number; elementIndex: ElementIndex }
  | { type: "PLAY_FAILED"; message: string }
  | { type: "SAVE_FAILED"; message: string };

type AudiobookPlayerContext = {
  session: AudiobookPlayerSession;
  environment: AudiobookPlayerEnvironment;
  /** The two audio elements while the player is open. */
  elements: AudioElementPair | null;
  /** Where the listener is: the entry playing or about to play, and the offset in its audio. */
  location: TimelineLocation;
  error: string | null;
};

/**
 * The machine's context, event, and input types. XState only reads their types, so the values stay
 * empty; declaring them here avoids casting placeholder objects.
 */
const MACHINE_TYPES: {
  context?: AudiobookPlayerContext;
  events?: AudiobookPlayerEvent;
  input?: { session: AudiobookPlayerSession; environment: AudiobookPlayerEnvironment };
} = {};

/**
 * Loads the location once media may be requested, and starts it when Play was pressed meanwhile.
 * That start follows an await, which browsers allow only because Play unlocked the element.
 */
const AFTER_AUTHORIZATION = [
  {
    guard: stateIn({ authorizing: "playRequested" }),
    target: "ready.playing",
    actions: ["loadLocation", "preloadFollowingEntry", "startActiveElement"],
  },
  { target: "ready", actions: ["loadLocation", "preloadFollowingEntry"] },
] as const;

const MEDIA_ERROR_MESSAGE = "Audio could not be played. Press Play to try again.";

/**
 * Decides when the browser engine's audio elements load, start, pause, and swap.
 *
 * `closed` holds no elements. `authorizing` waits for the media authorization the first segment
 * request needs; Play pressed meanwhile is remembered in `playRequested`. `ready` has the location
 * loaded and is `paused` or `playing`, where a stalled element is `buffering`. Media events count
 * only in the states where they mean something, and only from the element playing the location.
 *
 * Element work is imperative and runs as transition actions, synchronously within `send`.
 */
export const audiobookPlayerMachine = setup({
  types: MACHINE_TYPES,
  actors: {
    authorizeMedia: fromPromise<void, { session: AudiobookPlayerSession }>(({ input }) =>
      input.session.authorizeMedia(),
    ),
  },
  guards: {
    hasAudio: ({ context }) => context.session.timeline.entries.length > 0,
    isAtLastEntry: ({ context }) =>
      context.location.entryIndex + 1 >= context.session.timeline.entries.length,
    /** The event comes from the active element while it holds the location's segment. */
    isFromActiveSegment: ({ context, event }) => {
      assertEvent(event, Object.values(MEDIA_EVENT_TYPES));
      return requireElements(context).holdsActiveSegment(
        event.elementIndex,
        context.location.entryIndex,
      );
    },
    isFromActiveElement: ({ context, event }) => {
      assertEvent(event, Object.values(MEDIA_EVENT_TYPES));
      return requireElements(context).activeIndex === event.elementIndex;
    },
    isSettledTimeUpdate: ({ context, event }) => {
      assertEvent(event, MEDIA_EVENT_TYPES.timeupdate);
      return !requireElements(context).elementAt(event.elementIndex).seeking;
    },
    /** Pauses from a seek's restart arrive once the element plays again; only a lasting one counts. */
    isLastingPause: ({ context, event }) => {
      assertEvent(event, MEDIA_EVENT_TYPES.pause);
      const element = requireElements(context).elementAt(event.elementIndex);
      return element.paused && !element.ended;
    },
    isStillFollowing: ({ context, event }) => {
      assertEvent(event, "PRELOAD_AUTHORIZED");
      return (
        context.location.entryIndex + 1 === event.entryIndex &&
        requireElements(context).activeIndex !== event.elementIndex
      );
    },
  },
  actions: {
    createElements: assign({
      elements: ({ context, self }) =>
        new AudioElementPair(context.environment, context.session.timeline, (event) => {
          self.send(event);
        }),
    }),
    releaseElements: assign({
      elements: ({ context }) => {
        requireElements(context).release();
        return null;
      },
    }),
    clearError: assign({ error: null }),
    assignSeekLocation: assign(({ event }) => {
      assertEvent(event, "SEEK");
      return { location: event.location, error: null };
    }),
    assignActiveElementTime: assign(({ context, event }) => {
      assertEvent(event, MEDIA_EVENT_TYPES.timeupdate);
      const element = requireElements(context).elementAt(event.elementIndex);
      return {
        location: { ...context.location, offsetMilliseconds: element.currentTime * 1_000 },
      };
    }),
    assignFollowingEntry: assign(({ context }) => ({
      location: { entryIndex: context.location.entryIndex + 1, offsetMilliseconds: 0 },
    })),
    assignStart: assign({ location: { entryIndex: 0, offsetMilliseconds: 0 } }),
    assignMediaError: assign({ error: MEDIA_ERROR_MESSAGE }),
    assignFailure: assign(({ event }) => {
      assertEvent(event, ["PLAY_FAILED", "SAVE_FAILED"]);
      return { error: event.message };
    }),

    loadLocation: ({ context }) => {
      const elements = requireElements(context);
      elements.load(
        elements.activeIndex,
        context.location.entryIndex,
        context.location.offsetMilliseconds,
      );
    },
    moveElementsToLocation: ({ context }) => {
      requireElements(context).moveTo(
        context.location.entryIndex,
        context.location.offsetMilliseconds,
      );
    },
    activateStandbyElement: ({ context }) => {
      const elements = requireElements(context);
      elements.activeIndex = elements.standbyIndex;
    },
    forgetLoadedSegment: ({ context, event }) => {
      assertEvent(event, MEDIA_EVENT_TYPES.error);
      // A preloaded segment that failed is loaded again when playback reaches it.
      requireElements(context).forget(event.elementIndex);
    },
    loadPreloadedEntry: ({ context, event }) => {
      assertEvent(event, "PRELOAD_AUTHORIZED");
      requireElements(context).load(event.elementIndex, event.entryIndex);
    },
    preloadFollowingEntry: ({ context, self }) => {
      const elements = requireElements(context);
      const entryIndex = context.location.entryIndex + 1;
      const elementIndex = elements.standbyIndex;
      if (
        entryIndex >= context.session.timeline.entries.length ||
        elements.loadedEntryIndexOf(elementIndex) === entryIndex
      ) {
        return;
      }

      // Media authorization can expire during a long audiobook; renew it ahead of each request.
      void context.session
        .authorizeMedia()
        .then(() => {
          self.send({ type: "PRELOAD_AUTHORIZED", entryIndex, elementIndex });
          return undefined;
        })
        .catch(() => {
          // The segment is loaded when it becomes active, where a failure is reported.
        });
    },
    unlockActiveElement: ({ context }) => {
      const elements = requireElements(context);
      elements.unlock(elements.activeIndex);
    },
    unlockStandbyElement: ({ context }) => {
      const elements = requireElements(context);
      elements.unlock(elements.standbyIndex);
    },
    startActiveElement: ({ context, self }) => {
      requireElements(context).start(context.location, (message) => {
        self.send({ type: "PLAY_FAILED", message });
      });
    },
    pauseActiveElement: ({ context }) => {
      requireElements(context).active.pause();
    },
    save: ({ context, self }) => {
      savePosition(context, "now", self.send);
    },
    saveIfDue: ({ context, self }) => {
      savePosition(context, "if-due", self.send);
    },
  },
}).createMachine({
  id: "audiobookPlayer",
  context: ({ input }) => ({
    session: input.session,
    environment: input.environment,
    elements: null,
    location: input.session.initialLocation,
    error: null,
  }),
  initial: "closed",
  states: {
    closed: {
      on: {
        OPEN: [
          { guard: "hasAudio", target: "authorizing", actions: "createElements" },
          { target: "ready", actions: "createElements" },
        ],
      },
    },
    authorizing: {
      invoke: {
        src: "authorizeMedia",
        input: ({ context }) => ({ session: context.session }),
        onDone: AFTER_AUTHORIZATION,
        // An unauthorized segment fails to load, which is reported once playback is requested.
        onError: AFTER_AUTHORIZATION,
      },
      initial: "idle",
      states: {
        idle: {
          on: {
            // Mobile Safari and other browsers refuse audio started after an await, so these
            // unlocks must stay synchronous actions of this transition, never invoked actors.
            // Nothing may load before authorization: both elements unlock with silence, and the
            // active one starts its segment once authorization finishes.
            PLAY: {
              target: "playRequested",
              actions: ["clearError", "unlockActiveElement", "unlockStandbyElement"],
            },
          },
        },
        playRequested: {
          on: {
            PAUSE: { target: "idle", actions: ["pauseActiveElement", "save"] },
            "MEDIA.ERROR": [
              {
                guard: "isFromActiveElement",
                target: "idle",
                actions: ["forgetLoadedSegment", "assignMediaError"],
              },
              { actions: "forgetLoadedSegment" },
            ],
          },
        },
      },
      on: {
        // Nothing is loaded yet; the initial load picks up this location.
        SEEK: { actions: ["assignSeekLocation", "save"] },
        "MEDIA.ERROR": { actions: "forgetLoadedSegment" },
        SAVE_FAILED: { actions: "assignFailure" },
        CLOSE: { target: "closed", actions: ["save", "releaseElements"] },
      },
    },
    ready: {
      initial: "paused",
      states: {
        paused: {
          on: {
            // Mobile Safari and other browsers refuse audio started after an await. These element
            // starts must stay synchronous actions of this transition, never invoked actors.
            PLAY: {
              guard: "hasAudio",
              target: "playing",
              actions: ["clearError", "unlockStandbyElement", "startActiveElement"],
            },
            SEEK: {
              actions: [
                "assignSeekLocation",
                "moveElementsToLocation",
                "save",
                "preloadFollowingEntry",
              ],
            },
          },
        },
        playing: {
          initial: "streaming",
          states: {
            streaming: {
              on: {
                "MEDIA.WAITING": { guard: "isFromActiveSegment", target: "buffering" },
                // Follows pauses made outside the player, such as an audio interruption by the system.
                "MEDIA.PAUSE": {
                  guard: and(["isFromActiveSegment", "isLastingPause"]),
                  target: "#audiobookPlayer.ready.paused",
                  actions: ["pauseActiveElement", "save"],
                },
              },
            },
            buffering: {
              on: {
                "MEDIA.PLAYING": { guard: "isFromActiveSegment", target: "streaming" },
              },
            },
          },
          on: {
            PAUSE: { target: "paused", actions: ["pauseActiveElement", "save"] },
            SEEK: {
              actions: [
                "assignSeekLocation",
                "moveElementsToLocation",
                "save",
                "preloadFollowingEntry",
                "startActiveElement",
              ],
            },
            "MEDIA.ENDED": [
              {
                guard: and(["isFromActiveSegment", "isAtLastEntry"]),
                target: "paused",
                actions: ["assignStart", "loadLocation", "save", "preloadFollowingEntry"],
              },
              {
                guard: "isFromActiveSegment",
                actions: [
                  "activateStandbyElement",
                  "assignFollowingEntry",
                  "startActiveElement",
                  "preloadFollowingEntry",
                ],
              },
            ],
            "MEDIA.ERROR": [
              {
                guard: "isFromActiveElement",
                target: "paused",
                actions: ["forgetLoadedSegment", "assignMediaError"],
              },
              { actions: "forgetLoadedSegment" },
            ],
            PLAY_FAILED: { target: "paused", actions: "assignFailure" },
          },
        },
      },
      on: {
        "MEDIA.TIME_UPDATE": {
          guard: and(["isFromActiveSegment", "isSettledTimeUpdate"]),
          actions: ["assignActiveElementTime", "saveIfDue"],
        },
        "MEDIA.ERROR": { actions: "forgetLoadedSegment" },
        PRELOAD_AUTHORIZED: { guard: "isStillFollowing", actions: "loadPreloadedEntry" },
        PLAY_FAILED: { actions: "assignFailure" },
        SAVE_FAILED: { actions: "assignFailure" },
        CLOSE: { target: "closed", actions: ["save", "releaseElements"] },
      },
    },
  },
});

function requireElements(context: AudiobookPlayerContext): AudioElementPair {
  if (!context.elements) {
    throw new Error("The audio elements are used while the player is closed.");
  }
  return context.elements;
}

function savePosition(
  context: AudiobookPlayerContext,
  when: "now" | "if-due",
  send: (event: AudiobookPlayerEvent) => void,
) {
  const reported = context.session.reportedPositionAt(context.location);
  const save =
    when === "now" ? context.session.save(reported) : context.session.saveIfDue(reported);
  void save.catch((error: unknown) => {
    send({
      type: "SAVE_FAILED",
      message: error instanceof Error ? error.message : "Listening position could not be saved.",
    });
  });
}

/**
 * The two audio elements and which segment each holds. One is active and plays the location; the
 * other is on standby and preloads the following segment.
 */
class AudioElementPair {
  activeIndex: ElementIndex = 0;
  private readonly elements: [AudiobookAudioElement, AudiobookAudioElement];
  private readonly timeline: AudiobookTimeline;
  private readonly silenceUrl: string;
  private readonly loadedEntryIndexes: [number | null, number | null] = [null, null];
  private readonly hasUnlockedElement: [boolean, boolean] = [false, false];
  private readonly removeListeners: () => void;

  constructor(
    environment: AudiobookPlayerEnvironment,
    timeline: AudiobookTimeline,
    onMediaEvent: (event: MediaEvent) => void,
  ) {
    this.elements = [environment.createAudioElement(), environment.createAudioElement()];
    this.timeline = timeline;
    this.silenceUrl = environment.silenceUrl;

    const removers = this.elements.flatMap((element, index) => {
      const elementIndex: ElementIndex = index === 0 ? 0 : 1;
      return Object.entries(MEDIA_EVENT_TYPES).map(([domType, type]) => {
        const listener = () => onMediaEvent({ type, elementIndex });
        element.addEventListener(domType, listener);
        return () => element.removeEventListener(domType, listener);
      });
    });
    this.removeListeners = () => {
      for (const remove of removers) {
        remove();
      }
    };
  }

  get standbyIndex(): ElementIndex {
    return this.activeIndex === 0 ? 1 : 0;
  }

  get active() {
    return this.elements[this.activeIndex];
  }

  elementAt(elementIndex: ElementIndex) {
    return this.elements[elementIndex];
  }

  loadedEntryIndexOf(elementIndex: ElementIndex) {
    return this.loadedEntryIndexes[elementIndex];
  }

  /** Whether an element is the active one and holds the entry; the other plays silence or preloads. */
  holdsActiveSegment(elementIndex: ElementIndex, entryIndex: number) {
    return (
      this.activeIndex === elementIndex && this.loadedEntryIndexes[elementIndex] === entryIndex
    );
  }

  load(elementIndex: ElementIndex, entryIndex: number, offsetMilliseconds = 0) {
    const element = this.elements[elementIndex];
    const entry = this.timeline.entries[entryIndex];
    if (!entry) {
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

  forget(elementIndex: ElementIndex) {
    this.loadedEntryIndexes[elementIndex] = null;
  }

  /** Makes the element holding an entry active, seeking within it, or loads it on standby first. */
  moveTo(entryIndex: number, offsetMilliseconds: number) {
    const standbyIndex = this.standbyIndex;
    this.active.pause();

    if (this.loadedEntryIndexes[this.activeIndex] === entryIndex) {
      this.active.currentTime = offsetMilliseconds / 1_000;
    } else if (this.loadedEntryIndexes[standbyIndex] === entryIndex) {
      this.activeIndex = standbyIndex;
      this.active.currentTime = offsetMilliseconds / 1_000;
    } else {
      // Replacing the source of the element the media controls follow makes Android browsers
      // drop and recreate their notification, so the segment starts on the standby element.
      this.activeIndex = standbyIndex;
      this.load(standbyIndex, entryIndex, offsetMilliseconds);
    }
  }

  /**
   * Mobile Safari lets an audio element start only once it was played within a user gesture.
   * Starting both elements muted inside the Play gesture allows every later start, including
   * boundary swaps. An element without a segment plays a short silence for this.
   */
  unlock(elementIndex: ElementIndex) {
    const element = this.elements[elementIndex];
    if (this.hasUnlockedElement[elementIndex]) {
      return;
    }

    this.hasUnlockedElement[elementIndex] = true;
    if (this.loadedEntryIndexes[elementIndex] === null) {
      element.src = this.silenceUrl;
    }
    element.muted = true;
    void element
      .play()
      .then(() => {
        const isPlayingItsSegment =
          elementIndex === this.activeIndex && this.loadedEntryIndexes[elementIndex] !== null;
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
      this.load(this.activeIndex, location.entryIndex, location.offsetMilliseconds);
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

  release() {
    this.removeListeners();
    for (const element of this.elements) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
  }
}
