import { createActor, type SnapshotFrom } from "xstate";

import type { AudiobookPlayerEnvironment } from "#src/app/player/audio-element-pair.ts";
import {
  audiobookPlayerMachine,
  type AudiobookPlayerSession,
} from "#src/app/player/audiobook-player-machine.ts";
import {
  findTimelineEntryIndex,
  locateTimelinePosition,
} from "#src/app/player/audiobook-timeline.ts";
import type { Player, PlayerSnapshot } from "#src/platform/player.ts";

/**
 * Plays an audiobook's audio segments as one continuous timeline.
 *
 * Two audio elements alternate: one plays while the other preloads the following segment, so a
 * segment boundary needs no loading pause. See ADR 0008. The
 * [machine](./audiobook-player-machine.ts) decides when the elements load, start, and swap; this
 * class translates the `Player` contract into its events and its state into player snapshots.
 */
export class AudiobookPlayer implements Player {
  private readonly session: AudiobookPlayerSession;
  private readonly actor;
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot;

  constructor(session: AudiobookPlayerSession, environment: AudiobookPlayerEnvironment) {
    this.session = session;
    this.actor = createActor(audiobookPlayerMachine, { input: { session, environment } });
    this.snapshot = this.toPlayerSnapshot(this.actor.getSnapshot());
    this.actor.subscribe((state) => {
      this.publish(state);
    });
    this.actor.start();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  open = () => {
    this.actor.send({ type: "OPEN" });
  };

  close = () => {
    this.actor.send({ type: "CLOSE" });
  };

  /**
   * Must be called from a user gesture: browsers only then allow both elements to start. The
   * machine starts them while handling this event, before `send` returns.
   */
  play = () => {
    this.actor.send({ type: "PLAY" });
  };

  pause = () => {
    this.actor.send({ type: "PAUSE" });
  };

  /** Moves by segments with audio, so a skipped segment is never a destination. */
  skip = (direction: 1 | -1) => {
    const unitIndex = this.session.adjacentUnitIndex(this.snapshot.currentUnitIndex, direction);
    if (unitIndex !== undefined) {
      this.seekToUnit(unitIndex);
    }
  };

  /** Seeks to the start of a unit, or of the next unit with audio when it was skipped. */
  seekToUnit = (unitIndex: number) => {
    const entryIndex = findTimelineEntryIndex(this.session.timeline, unitIndex);
    if (entryIndex < 0) {
      return;
    }

    this.actor.send({ type: "SEEK", location: { entryIndex, offsetMilliseconds: 0 } });
  };

  /** Seeks to a position on the whole-audiobook timeline. */
  seekTo = (positionMilliseconds: number) => {
    const location = locateTimelinePosition(this.session.timeline, positionMilliseconds);
    if (!location) {
      return;
    }

    this.actor.send({ type: "SEEK", location });
  };

  /**
   * Replaces the snapshot only when a reported value changed. Time updates arrive several times a
   * second, and React's `useSyncExternalStore` re-renders whenever `getSnapshot` returns a new
   * object.
   */
  private publish(state: SnapshotFrom<typeof audiobookPlayerMachine>) {
    const next = this.toPlayerSnapshot(state);
    if (isSameSnapshot(next, this.snapshot)) {
      return;
    }

    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private toPlayerSnapshot(state: SnapshotFrom<typeof audiobookPlayerMachine>): PlayerSnapshot {
    return {
      ...this.session.reportedPositionAt(state.context.location),
      durationMilliseconds: this.session.timeline.durationMilliseconds,
      isPlaying:
        state.matches({ open: { ready: "playing" } }) ||
        state.matches({ open: { authorizing: "playRequested" } }),
      isBuffering: state.matches({ open: { ready: { playing: "buffering" } } }),
      error: state.context.error,
    };
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
