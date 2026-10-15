import type { Audiobook, PlaybackPosition } from "@cup/web-app-api.routes";

import {
  createAudiobookTimeline,
  findTimelineEntryIndex,
  type AudiobookTimeline,
} from "#src/app/player/audiobook-timeline.ts";
import type { ReportedPosition, TimelineLocation } from "#src/platform/player.ts";

/** A conversion whose narration document is prepared, whatever the state of its audio. */
export type PreparedAudiobook = Extract<
  Audiobook,
  { status: "insufficient-duration" | "synthesizing" | "ready" }
>;
/** An audiobook whose every segment has audio or a final failure. */
export type PlayableAudiobook = Extract<Audiobook, { status: "ready" }>;

export type PlaybackSessionRequest = {
  conversionId: string;
  audiobook: PlayableAudiobook;
  /** The listening position to restore, from the listener's account or this device. */
  position: PlaybackPosition | null;
  /** The signed-in user the audiobook is loaded for; `null` for anonymous and trial listeners. */
  subject: string | null;
};

export type PlaybackSessionServices = {
  /** The signed-in account's current identity and bearer token, or `null` when nobody is signed in. */
  getAccount(): Promise<{ subject: string; accessToken: string } | null>;
  /** Issues the media cookie scoped to `/api/files` for the signed-in account. */
  issueMediaCookie(): Promise<void>;
  /**
   * Persists a position for the signed-in `subject`, or on this device when `null`. It must refuse
   * to write when another account is signed in by the time the request is sent.
   */
  savePosition(position: PlaybackPosition, subject: string | null): Promise<void>;
  now(): number;
};

export const SAVE_INTERVAL_MILLISECONDS = 5_000;

/**
 * Establishes that one subject may fetch one loaded audiobook's media from a listening position.
 *
 * It owns the subject check, media authorization, the conversion between listening positions and
 * the whole-audiobook timeline, and the save cadence. Engines only play segments on its timeline.
 */
export class PlaybackSession {
  readonly conversionId: string;
  readonly audiobook: PlayableAudiobook;
  readonly subject: string | null;
  readonly timeline: AudiobookTimeline;
  /** Where playback starts: the restored listening position, or the start of the audiobook. */
  readonly initialLocation: TimelineLocation;

  private readonly services: PlaybackSessionServices;
  private pendingMediaAuthorization: Promise<void> | undefined;
  private lastSavedAt = Number.NEGATIVE_INFINITY;
  private saves: Promise<void> = Promise.resolve();

  constructor(request: PlaybackSessionRequest, services: PlaybackSessionServices) {
    this.conversionId = request.conversionId;
    this.audiobook = request.audiobook;
    this.subject = request.subject;
    this.services = services;
    this.timeline = createAudiobookTimeline(request.audiobook.segments);
    this.initialLocation = this.restore(request.position);
  }

  /** The position players report for a location: its unit and the whole-audiobook position. */
  reportedPositionAt = (location: TimelineLocation): ReportedPosition => {
    const entry = this.timeline.entries[location.entryIndex];
    return {
      currentUnitIndex: entry?.unitIndex ?? 0,
      positionMilliseconds: (entry?.startMilliseconds ?? 0) + location.offsetMilliseconds,
    };
  };

  /** The listening position a player reports, or `null` when the audiobook has no audio. */
  listeningPositionOf = (reported: ReportedPosition): PlaybackPosition | null => {
    // Players report only units with audio; a skipped unit would resolve to the next one with audio.
    const entry =
      this.timeline.entries[findTimelineEntryIndex(this.timeline, reported.currentUnitIndex)];
    const unit = entry && this.audiobook.narrationDocument.synchronizationUnits[entry.unitIndex];
    if (!entry || !unit) return null;

    return {
      synchronizationUnitId: unit.id,
      offsetMilliseconds: Math.max(0, reported.positionMilliseconds - entry.startMilliseconds),
    };
  };

  /**
   * The unit with audio `direction` segments away from a unit, so skipping never lands on a skipped
   * segment.
   */
  adjacentUnitIndex = (unitIndex: number, direction: 1 | -1): number | undefined => {
    const entryIndex = this.timeline.entries.findIndex((entry) => entry.unitIndex === unitIndex);
    if (entryIndex < 0) return undefined;

    return this.timeline.entries[entryIndex + direction]?.unitIndex;
  };

  /**
   * Issues the media cookie for the subject before media requests. Anonymous and trial listeners
   * need none: the grant cookie or public access covers their media.
   *
   * Calls while one is in flight share it, so loading, opening the engine and Play in one gesture
   * issue one cookie. A settled cookie is never reused: its lifetime is computed on the server's
   * clock, which the client cannot compare against its own, so every later need issues a new one.
   */
  authorizeMedia = (): Promise<void> => {
    if (this.subject === null) return Promise.resolve();
    if (this.pendingMediaAuthorization) return this.pendingMediaAuthorization;

    const authorization = this.requireSubjectAccount().then(() => this.services.issueMediaCookie());
    this.pendingMediaAuthorization = authorization;
    const clearPending = () => {
      if (this.pendingMediaAuthorization === authorization)
        this.pendingMediaAuthorization = undefined;
    };
    authorization.then(clearPending, clearPending);
    return authorization;
  };

  /**
   * The subject's current bearer token, for engines that send it themselves, or `null` for
   * anonymous and trial listeners. It issues no media cookie.
   */
  getAccessToken = async (): Promise<string | null> => {
    if (this.subject === null) return null;

    const account = await this.requireSubjectAccount();
    return account.accessToken;
  };

  /** Saves a reported position now. Saves are written in order. */
  save = (reported: ReportedPosition): Promise<void> => {
    const position = this.listeningPositionOf(reported);
    if (!position) return Promise.resolve();

    this.lastSavedAt = this.services.now();
    const save = this.saves.catch(() => undefined).then(() => this.persist(position));
    this.saves = save;
    return save;
  };

  /** Saves during playback, at most every `SAVE_INTERVAL_MILLISECONDS`. */
  saveIfDue = (reported: ReportedPosition): Promise<void> => {
    if (this.services.now() - this.lastSavedAt < SAVE_INTERVAL_MILLISECONDS)
      return Promise.resolve();

    return this.save(reported);
  };

  /**
   * A skipped unit resumes at the start of the next unit with audio; an unknown unit, or one after
   * the last audio, at the start of the audiobook.
   */
  private restore(position: PlaybackPosition | null): TimelineLocation {
    const start = { entryIndex: 0, offsetMilliseconds: 0 };
    if (!position) return start;

    const unitIndex = this.audiobook.narrationDocument.synchronizationUnits.findIndex(
      (unit) => unit.id === position.synchronizationUnitId,
    );
    if (unitIndex < 0) return start;
    const entryIndex = findTimelineEntryIndex(this.timeline, unitIndex);
    if (entryIndex < 0) return start;

    const isRestoredUnitPlayable = this.timeline.entries[entryIndex]?.unitIndex === unitIndex;
    return {
      entryIndex,
      offsetMilliseconds: isRestoredUnitPlayable ? position.offsetMilliseconds : 0,
    };
  }

  private persist(position: PlaybackPosition) {
    // The request layer checks the subject when it resolves the token, right before dispatch.
    return this.services.savePosition(position, this.subject);
  }

  /** The signed-in account, which must be the subject the audiobook was loaded for. */
  private async requireSubjectAccount() {
    const account = await this.services.getAccount();
    if (account === null || account.subject !== this.subject)
      throw new Error("Sign in again to continue playback.");
    return account;
  }
}
