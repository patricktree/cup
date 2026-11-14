import type { Audiobook, NarrationTrack, PlaybackPosition } from "@cup/listener-api.routes";

import { findUnitIndexAt, type AudiobookTimeline } from "#src/app/player/audiobook-timeline.ts";
import { describeError } from "#src/errors.ts";

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
  /** Calls `callback` once after the delay; the returned function cancels it. */
  setRetryTimer(callback: () => void, delayMilliseconds: number): () => void;
  /**
   * Calls `callback` whenever the connection may be back: the device went online, or the app
   * returned to the foreground. The returned function stops it.
   */
  onReconnect(callback: () => void): () => void;
};

export const SAVE_INTERVAL_MILLISECONDS = 5_000;
/** How long after a failed save its position is saved again, unless a newer save comes first. */
export const SAVE_RETRY_DELAY_MILLISECONDS = 15_000;
/** Shown once a failed save's retry failed too; the session keeps trying. */
export const SAVE_RETRY_FAILURE_MESSAGE =
  "Your listening position could not be saved yet. Cup keeps trying.";
const SAVE_FAILURE_TITLE = "Your listening position could not be saved.";

/** A save the listener's playback asked for, or the retry of one that failed. */
type SaveAttempt = "new" | "retry";
type SaveRequest = { position: PlaybackPosition; attempt: SaveAttempt; saveNumber: number };

export function isPlayableAudiobook(audiobook: PreparedAudiobook): audiobook is PlayableAudiobook {
  return audiobook.status === "ready" && audiobook.narrationTrack !== undefined;
}

/**
 * Where a listening position lies on the audiobook's narration track. No position, or an unknown
 * unit such as one removed from the narration document, is the start.
 */
export function toTrackPositionMilliseconds(
  audiobook: PlayableAudiobook,
  position: PlaybackPosition | null,
): number {
  if (!position) {
    return 0;
  }

  const unitIndex = audiobook.narrationDocument.synchronizationUnits.findIndex(
    (unit) => unit.id === position.synchronizationUnitId,
  );
  if (unitIndex < 0) {
    return 0;
  }

  return audiobook.narrationTrack.startMilliseconds[unitIndex]! + position.offsetMilliseconds;
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
  /** Counts save requests, so only the latest one's failure arms a retry. */
  private latestSaveNumber = 0;
  /** Cancels the armed retry of the latest position, whose save failed. */
  private cancelArmedRetry: (() => void) | null = null;
  /** When the saves started failing for a reason that can pass; `null` after a successful one. */
  private failingSince: number | null = null;
  private saveFailure: string | null = null;
  private readonly saveFailureListeners = new Set<() => void>();
  private isClosed = false;

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
    this.initialPositionMilliseconds = toTrackPositionMilliseconds(
      request.audiobook,
      request.position,
    );
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

  /**
   * Saves a position on the narration track now. Saves are written in order, and the returned
   * promise resolves once this one was written or failed; `getSaveFailure` reports failures. A save
   * that fails for a reason that can pass, such as a lost connection, is saved again later, unless
   * a newer save comes first.
   */
  save = (positionMilliseconds: number): Promise<void> =>
    this.enqueueSave(this.listeningPositionAt(positionMilliseconds), "new");

  /**
   * The failure to show the listener, in plain words, or `null`. A failure that a retry may fix
   * shows only once a retry, after the retry delay or a reconnect, failed too, or saves have failed
   * for as long as the retry delay; any successful save clears it.
   */
  getSaveFailure = () => this.saveFailure;

  subscribeSaveFailure = (listener: () => void) => {
    this.saveFailureListeners.add(listener);
    return () => {
      this.saveFailureListeners.delete(listener);
    };
  };

  /** Stops retrying a failed save, which the session then no longer reports. */
  close = () => {
    this.isClosed = true;
    this.disarmRetry();
    this.saveFailureListeners.clear();
  };

  /** Saves during playback, at most every `SAVE_INTERVAL_MILLISECONDS`. */
  saveIfDue = (positionMilliseconds: number): Promise<void> => {
    if (this.services.now() - this.lastSavedAt < SAVE_INTERVAL_MILLISECONDS) {
      return Promise.resolve();
    }

    return this.save(positionMilliseconds);
  };

  private enqueueSave(position: PlaybackPosition, attempt: SaveAttempt): Promise<void> {
    this.disarmRetry();
    this.latestSaveNumber += 1;
    const request: SaveRequest = { position, attempt, saveNumber: this.latestSaveNumber };

    this.lastSavedAt = this.services.now();
    const save = this.saves.then(() => this.writeSave(request));
    // A failing listener or service must not stop the saves queued after this one.
    this.saves = save.catch(() => undefined);
    return save;
  }

  private async writeSave(request: SaveRequest) {
    // A retry queued before the session closed, such as for a track being deleted, has no use.
    if (this.isClosed && request.attempt === "retry") {
      return;
    }

    try {
      // The request layer checks the subject when it resolves the token, right before dispatch.
      await this.services.savePosition(request.position, this.subject);
    } catch (error) {
      this.handleSaveError(error, request);
      return;
    }
    this.failingSince = null;
    this.setSaveFailure(null);
  }

  private handleSaveError(error: unknown, { position, attempt, saveNumber }: SaveRequest) {
    const description = describeError(error, SAVE_FAILURE_TITLE);
    if (!description.isRetryable) {
      // A lasting refusal, such as a signed-out listener; saving again would be refused too.
      this.setSaveFailure(description.detail ?? description.title);
      return;
    }

    // A newer save is queued already and carries a later position; its outcome counts.
    if (saveNumber !== this.latestSaveNumber) {
      return;
    }

    this.failingSince ??= this.services.now();
    // During playback, newer saves replace the retry every few seconds; they stay quiet until saves
    // have failed for as long as the retry delay.
    const hasFailedForRetryDelay =
      this.services.now() - this.failingSince >= SAVE_RETRY_DELAY_MILLISECONDS;
    if (attempt === "retry" || hasFailedForRetryDelay) {
      this.setSaveFailure(SAVE_RETRY_FAILURE_MESSAGE);
    }
    this.armRetry(position);
  }

  private setSaveFailure(failure: string | null) {
    if (this.isClosed || failure === this.saveFailure) {
      return;
    }

    this.saveFailure = failure;
    for (const listener of this.saveFailureListeners) {
      listener();
    }
  }

  private armRetry(position: PlaybackPosition) {
    if (this.isClosed) {
      return;
    }

    const retry = () => {
      void this.enqueueSave(position, "retry");
    };
    const cancelTimer = this.services.setRetryTimer(retry, SAVE_RETRY_DELAY_MILLISECONDS);
    const stopReconnect = this.services.onReconnect(retry);
    this.cancelArmedRetry = () => {
      cancelTimer();
      stopReconnect();
    };
  }

  private disarmRetry() {
    this.cancelArmedRetry?.();
    this.cancelArmedRetry = null;
  }
}
