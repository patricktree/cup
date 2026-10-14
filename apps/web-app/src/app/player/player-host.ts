import type { PlaybackPosition } from "@cup/web-app-api.routes";

import type { PlayableAudiobook } from "#src/app/player/audiobook-player.ts";
import {
  createAudiobookTimeline,
  findTimelineEntryIndex,
} from "#src/app/player/audiobook-timeline.ts";
import type { Player } from "#src/platform/player.ts";

/** The one audiobook the app's player holds, with the engine playing it. */
export type LoadedAudiobook = {
  conversionId: string;
  audiobook: PlayableAudiobook;
  /** The signed-in user the audiobook was loaded for; `null` for anonymous and trial listeners. */
  subject: string | null;
  player: Player;
  /** Playing an audiobook with segments whose synthesis finally failed needs the listener's consent. */
  hasPlaybackConsent: boolean;
};

export type PlayerHostSnapshot = {
  loaded: LoadedAudiobook | null;
  authorizationError: string | null;
};

export type LoadRequest = {
  conversionId: string;
  audiobook: PlayableAudiobook;
  position: PlaybackPosition | null;
  subject: string | null;
  hasPlaybackConsent: boolean;
};

export type PlayerHostServices = {
  createPlayer(
    conversionId: string,
    audiobook: PlayableAudiobook,
    position: PlaybackPosition | null,
    subject: string | null,
  ): Player;
  registerMediaSession(player: Player, title: string): (() => void) | undefined;
  authorize(): Promise<void>;
};

/**
 * Holds the app's single player, so playback continues while the listener navigates.
 *
 * Loading an audiobook never starts playback; only `play` does, which must run within a user
 * gesture. Loading another audiobook saves and closes the previous player.
 */
export class PlayerHost {
  private readonly services: PlayerHostServices;
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerHostSnapshot = { loaded: null, authorizationError: null };
  private unregisterMediaSession: (() => void) | undefined;

  constructor(services: PlayerHostServices) {
    this.services = services;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  load = (request: LoadRequest) => {
    this.closeLoadedPlayer();

    const player = this.services.createPlayer(
      request.conversionId,
      request.audiobook,
      request.position,
      request.subject,
    );
    player.open();
    this.unregisterMediaSession = this.services.registerMediaSession(
      player,
      request.audiobook.title,
    );
    this.update({
      loaded: {
        conversionId: request.conversionId,
        audiobook: request.audiobook,
        subject: request.subject,
        player,
        hasPlaybackConsent: request.hasPlaybackConsent,
      },
      authorizationError: null,
    });

    void this.services
      .authorize()
      .catch((error: unknown) =>
        this.reportAuthorizationError(player, error, "Playback authorization failed."),
      );
  };

  /** Must be called from a user gesture: browsers only then allow audio to start. */
  play = () => {
    const loaded = this.snapshot.loaded;
    if (!loaded?.hasPlaybackConsent) return;

    const { player } = loaded;
    // Start within the user gesture; browsers refuse audio that starts after awaiting.
    player.play();
    void this.services
      .authorize()
      .then(() => {
        if (this.snapshot.loaded?.player === player) this.update({ authorizationError: null });
        return undefined;
      })
      .catch((error: unknown) => {
        player.pause();
        this.reportAuthorizationError(
          player,
          error,
          "Playback authorization could not be refreshed.",
        );
      });
  };

  /** Must be called from a user gesture, like `play`. */
  playFromUnit = (unitIndex: number) => {
    this.snapshot.loaded?.player.seekToUnit(unitIndex);
    this.play();
  };

  pause = () => {
    this.snapshot.loaded?.player.pause();
  };

  /** Loads and plays in one user gesture, optionally from the start of a unit. */
  loadAndPlay = (request: LoadRequest, unitIndex?: number) => {
    this.load(request);
    if (unitIndex === undefined) this.play();
    else this.playFromUnit(unitIndex);
  };

  consentToSkippingSegmentsWithoutAudio = () => {
    const loaded = this.snapshot.loaded;
    if (!loaded || loaded.hasPlaybackConsent) return;

    this.update({ loaded: { ...loaded, hasPlaybackConsent: true } });
  };

  /**
   * Swaps in a newer version of the loaded audiobook, such as one whose failed segments now have
   * audio, at the current position. Only while paused: a new player could start only from a
   * gesture.
   */
  replaceAudiobook = (audiobook: PlayableAudiobook) => {
    const loaded = this.snapshot.loaded;
    if (!loaded) return;
    if (loaded.player.getSnapshot().isPlaying)
      throw new Error("The loaded audiobook can only be replaced while paused.");

    this.load({
      conversionId: loaded.conversionId,
      audiobook,
      position: describeListeningPosition(loaded),
      subject: loaded.subject,
      // With every segment's audio now present, nothing is left to skip and so nothing to consent to.
      hasPlaybackConsent: loaded.hasPlaybackConsent || !hasSegmentsWithoutAudio(audiobook),
    });
  };

  unload = () => {
    if (!this.snapshot.loaded) return;

    this.closeLoadedPlayer();
    this.update({ loaded: null, authorizationError: null });
  };

  private closeLoadedPlayer() {
    const loaded = this.snapshot.loaded;
    if (!loaded) return;

    this.unregisterMediaSession?.();
    this.unregisterMediaSession = undefined;
    loaded.player.pause();
    loaded.player.close();
  }

  /** Reports a failure only while the player it concerns is still the loaded one. */
  private reportAuthorizationError(player: Player, error: unknown, fallbackMessage: string) {
    if (this.snapshot.loaded?.player !== player) return;

    this.update({ authorizationError: error instanceof Error ? error.message : fallbackMessage });
  }

  private update(value: Partial<PlayerHostSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    for (const listener of this.listeners) listener();
  }
}

/** The loaded player's current unit and offset within that unit's audio. */
function describeListeningPosition(loaded: LoadedAudiobook): PlaybackPosition {
  const { currentUnitIndex, positionMilliseconds } = loaded.player.getSnapshot();
  const timeline = createAudiobookTimeline(loaded.audiobook.segments);
  const entry = timeline.entries[findTimelineEntryIndex(timeline, currentUnitIndex)];
  const unit = loaded.audiobook.narrationDocument.synchronizationUnits[currentUnitIndex];
  // A player only reports units of its own audiobook that have audio.
  if (!entry || !unit)
    throw new Error(`The loaded player reports unit ${currentUnitIndex}, which has no audio.`);

  return {
    synchronizationUnitId: unit.id,
    offsetMilliseconds: Math.max(0, positionMilliseconds - entry.startMilliseconds),
  };
}

function hasSegmentsWithoutAudio(audiobook: PlayableAudiobook) {
  return audiobook.segments.some((segment) => segment.status !== "ready");
}
