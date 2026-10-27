import type { Audiobook, NarrationTrack, PlaybackPosition } from "@cup/listener-api.routes";

import { findUnitIndexAt, type AudiobookTimeline } from "#src/app/player/audiobook-timeline.ts";

/** A conversion whose narration document is prepared, whatever the state of its audio. */
export type PreparedAudiobook = Extract<
  Audiobook,
  { status: "insufficient-duration" | "synthesizing" | "ready" }
>;
/** An audiobook with a narration track: every segment has audio. */
export type PlayableAudiobook = Extract<Audiobook, { status: "ready" }> & {
  narrationTrack: NarrationTrack;
};

export type PlaybackSessionRequest = {
  conversionId: string;
  audiobook: PlayableAudiobook;
  /** The listening position to restore, from the listener's account or this device. */
  position: PlaybackPosition | null;
  /** The signed-in user the audiobook is loaded for; `null` for anonymous and trial listeners. */
  subject: string | null;
};

export type PlaybackSessionServices = {
  /**
   * Persists a position for the signed-in `subject`, or on this device when `null`. It must refuse
   * to write when another account is signed in by the time the request is sent.
   */
  savePosition(position: PlaybackPosition, subject: string | null): Promise<void>;
  now(): number;
};

export const SAVE_INTERVAL_MILLISECONDS = 5_000;

export function isPlayableAudiobook(audiobook: PreparedAudiobook): audiobook is PlayableAudiobook {
  return audiobook.status === "ready" && audiobook.narrationTrack !== undefined;
}

/**
 * One subject's listening session on one loaded audiobook.
 *
 * It converts between listening positions, a synchronization unit and an offset in its audio, and
 * positions on the narration track, and it owns the save cadence and order.
 */
export class PlaybackSession {
  readonly conversionId: string;
  readonly audiobook: PlayableAudiobook;
  readonly subject: string | null;
  readonly timeline: AudiobookTimeline;
  /** Where playback starts on the narration track: the restored listening position, or its start. */
  readonly initialPositionMilliseconds: number;

  private readonly services: PlaybackSessionServices;
  private lastSavedAt = Number.NEGATIVE_INFINITY;
  private saves: Promise<void> = Promise.resolve();

  constructor(request: PlaybackSessionRequest, services: PlaybackSessionServices) {
    const { narrationTrack, narrationDocument } = request.audiobook;
    const unitCount = narrationDocument.synchronizationUnits.length;
    if (narrationTrack.startMilliseconds.length !== unitCount) {
      throw new Error(
        `Audiobook ${request.conversionId} has ${narrationTrack.startMilliseconds.length} start offsets for ${unitCount} synchronization units.`,
      );
    }

    this.conversionId = request.conversionId;
    this.audiobook = request.audiobook;
    this.subject = request.subject;
    this.services = services;
    this.timeline = narrationTrack;
    this.initialPositionMilliseconds = this.restore(request.position);
  }

  /** The listening position at a position on the narration track. */
  listeningPositionAt = (positionMilliseconds: number): PlaybackPosition => {
    const unitIndex = findUnitIndexAt(this.timeline, positionMilliseconds);
    const unit = this.audiobook.narrationDocument.synchronizationUnits[unitIndex]!;

    return {
      synchronizationUnitId: unit.id,
      offsetMilliseconds: Math.max(
        0,
        positionMilliseconds - this.timeline.startMilliseconds[unitIndex]!,
      ),
    };
  };

  /** Saves a position on the narration track now. Saves are written in order. */
  save = (positionMilliseconds: number): Promise<void> => {
    const position = this.listeningPositionAt(positionMilliseconds);

    this.lastSavedAt = this.services.now();
    // The request layer checks the subject when it resolves the token, right before dispatch.
    const save = this.saves
      .catch(() => undefined)
      .then(() => this.services.savePosition(position, this.subject));
    this.saves = save;
    return save;
  };

  /** Saves during playback, at most every `SAVE_INTERVAL_MILLISECONDS`. */
  saveIfDue = (positionMilliseconds: number): Promise<void> => {
    if (this.services.now() - this.lastSavedAt < SAVE_INTERVAL_MILLISECONDS) {
      return Promise.resolve();
    }

    return this.save(positionMilliseconds);
  };

  /** An unknown unit, such as one removed from the narration document, restores the start. */
  private restore(position: PlaybackPosition | null): number {
    if (!position) {
      return 0;
    }

    const unitIndex = this.audiobook.narrationDocument.synchronizationUnits.findIndex(
      (unit) => unit.id === position.synchronizationUnitId,
    );
    if (unitIndex < 0) {
      return 0;
    }

    return this.timeline.startMilliseconds[unitIndex]! + position.offsetMilliseconds;
  }
}
