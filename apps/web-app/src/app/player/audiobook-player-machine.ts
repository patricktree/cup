import { and, assertEvent, assign, fromPromise, setup, stateIn } from "xstate";

import {
  AudioElementPair,
  MEDIA_EVENT_TYPES,
  type AudiobookPlayerEnvironment,
  type ElementIndex,
  type MediaEvent,
} from "#src/app/player/audio-element-pair.ts";
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
  /** The two audio elements; they exist only while the machine is `open`. */
  elements: AudioElementPair;
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
    guard: stateIn({ open: { authorizing: "playRequested" } }),
    target: "ready.playing",
    actions: ["loadLocation", "preloadFollowingEntry", "startActiveElement"],
  },
  { target: "ready", actions: ["loadLocation", "preloadFollowingEntry"] },
] as const;

const MEDIA_ERROR_MESSAGE = "Audio could not be played. Press Play to try again.";

/**
 * Decides when the browser engine's audio elements load, start, pause, and swap.
 *
 * `closed` holds no elements. Within `open`, `authorizing` waits for the media authorization the
 * first segment request needs and remembers Play pressed meanwhile in `playRequested`. `ready` has
 * the location loaded and is `paused` or `playing`, where a stalled element is `buffering`. Media
 * events count only in the states where they mean something, and only from the element playing the
 * location.
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
      return context.elements.holdsActiveSegment(event.elementIndex, context.location.entryIndex);
    },
    isFromActiveElement: ({ context, event }) => {
      assertEvent(event, Object.values(MEDIA_EVENT_TYPES));
      return context.elements.isActive(event.elementIndex);
    },
    isSettledTimeUpdate: ({ context, event }) => {
      assertEvent(event, MEDIA_EVENT_TYPES.timeupdate);
      return !context.elements.elementAt(event.elementIndex).seeking;
    },
    /** Pauses from a seek's restart arrive once the element plays again; only a lasting one counts. */
    isLastingPause: ({ context, event }) => {
      assertEvent(event, MEDIA_EVENT_TYPES.pause);
      const element = context.elements.elementAt(event.elementIndex);
      return element.paused && !element.ended;
    },
    isStillFollowing: ({ context, event }) => {
      assertEvent(event, "PRELOAD_AUTHORIZED");
      return (
        context.location.entryIndex + 1 === event.entryIndex &&
        !context.elements.isActive(event.elementIndex)
      );
    },
  },
  actions: {
    clearError: assign({ error: null }),
    assignSeekLocation: assign(({ event }) => {
      assertEvent(event, "SEEK");
      return { location: event.location, error: null };
    }),
    assignActiveElementTime: assign(({ context, event }) => {
      assertEvent(event, MEDIA_EVENT_TYPES.timeupdate);
      const element = context.elements.elementAt(event.elementIndex);
      return {
        location: { ...context.location, offsetMilliseconds: element.currentTime * 1_000 },
      };
    }),
    assignFollowingEntry: assign(({ context }) => ({
      location: { entryIndex: context.location.entryIndex + 1, offsetMilliseconds: 0 },
    })),
    assignTimelineStart: assign({ location: { entryIndex: 0, offsetMilliseconds: 0 } }),
    assignMediaError: assign({ error: MEDIA_ERROR_MESSAGE }),
    assignFailure: assign(({ event }) => {
      assertEvent(event, ["PLAY_FAILED", "SAVE_FAILED"]);
      return { error: event.message };
    }),

    attachElements: ({ context }) => {
      context.elements.attach();
    },
    releaseElements: ({ context }) => {
      context.elements.release();
    },
    loadLocation: ({ context }) => {
      context.elements.loadActive(context.location);
    },
    moveElementsToLocation: ({ context }) => {
      context.elements.moveTo(context.location);
    },
    activateStandbyElement: ({ context }) => {
      context.elements.activateStandby();
    },
    forgetLoadedSegment: ({ context, event }) => {
      assertEvent(event, MEDIA_EVENT_TYPES.error);
      // A preloaded segment that failed is loaded again when playback reaches it.
      context.elements.forget(event.elementIndex);
    },
    loadPreloadedEntry: ({ context, event }) => {
      assertEvent(event, "PRELOAD_AUTHORIZED");
      context.elements.load(event.elementIndex, event.entryIndex);
    },
    preloadFollowingEntry: ({ context, self }) => {
      const entryIndex = context.location.entryIndex + 1;
      const elementIndex = context.elements.standbyIndex;
      if (
        entryIndex >= context.session.timeline.entries.length ||
        context.elements.loadedEntryIndexOf(elementIndex) === entryIndex
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
    unlockBothElements: ({ context }) => {
      context.elements.unlockActive();
      context.elements.unlockStandby();
    },
    unlockStandbyElement: ({ context }) => {
      context.elements.unlockStandby();
    },
    startActiveElement: ({ context, self }) => {
      context.elements.start(context.location, (message) => {
        self.send({ type: "PLAY_FAILED", message });
      });
    },
    pauseActiveElement: ({ context }) => {
      context.elements.active.pause();
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
  context: ({ input, self }) => ({
    session: input.session,
    elements: new AudioElementPair(input.environment, input.session.timeline, (event) => {
      self.send(event);
    }),
    location: input.session.initialLocation,
    error: null,
  }),
  initial: "closed",
  states: {
    closed: {
      on: {
        // An audiobook without audio has nothing to authorize or load.
        OPEN: [
          { guard: "hasAudio", target: "open.authorizing", actions: "attachElements" },
          { target: "open.ready", actions: "attachElements" },
        ],
      },
    },
    open: {
      initial: "authorizing",
      states: {
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
                // Nothing may load before authorization: both elements unlock with silence, and
                // the active one starts its segment once authorization finishes.
                PLAY: { target: "playRequested", actions: ["clearError", "unlockBothElements"] },
              },
            },
            playRequested: {
              on: {
                PAUSE: { target: "idle", actions: ["pauseActiveElement", "save"] },
                "MEDIA.ERROR": {
                  guard: "isFromActiveElement",
                  target: "idle",
                  actions: ["forgetLoadedSegment", "assignMediaError"],
                },
              },
            },
          },
          on: {
            // Nothing is loaded yet; the initial load picks up this location.
            SEEK: { actions: ["assignSeekLocation", "save"] },
          },
        },
        ready: {
          initial: "paused",
          states: {
            paused: {
              on: {
                // Mobile Safari and other browsers refuse audio started after an await, so these
                // element starts must stay synchronous actions of this transition, never invoked
                // actors.
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
                    // Follows pauses made outside the player, such as an audio interruption.
                    "MEDIA.PAUSE": {
                      guard: and(["isFromActiveSegment", "isLastingPause"]),
                      target: "#audiobookPlayer.open.ready.paused",
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
                    actions: [
                      "assignTimelineStart",
                      "loadLocation",
                      "save",
                      "preloadFollowingEntry",
                    ],
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
                "MEDIA.ERROR": {
                  guard: "isFromActiveElement",
                  target: "paused",
                  actions: ["forgetLoadedSegment", "assignMediaError"],
                },
                PLAY_FAILED: { target: "paused", actions: "assignFailure" },
              },
            },
          },
          on: {
            "MEDIA.TIME_UPDATE": {
              guard: and(["isFromActiveSegment", "isSettledTimeUpdate"]),
              actions: ["assignActiveElementTime", "saveIfDue"],
            },
            PRELOAD_AUTHORIZED: { guard: "isStillFollowing", actions: "loadPreloadedEntry" },
            PLAY_FAILED: { actions: "assignFailure" },
          },
        },
      },
      on: {
        // Unhandled by a playing state above, an error only marks the element's segment unloaded.
        "MEDIA.ERROR": { actions: "forgetLoadedSegment" },
        SAVE_FAILED: { actions: "assignFailure" },
        CLOSE: { target: "closed", actions: ["save", "releaseElements"] },
      },
    },
  },
});

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
