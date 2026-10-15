import type { Audiobook, PlaybackPosition } from "@cup/listener-api.routes";

import type {
  PlayableAudiobook,
  PlaybackSession,
  PlaybackSessionRequest,
  PreparedAudiobook,
} from "#src/app/player/playback-session.ts";
import type { Player } from "#src/platform/player.ts";

/** The one audiobook the app's player holds, with the engine playing it. */
export type LoadedAudiobook = {
  conversionId: string;
  audiobook: PlayableAudiobook;
  /** The signed-in user the audiobook was loaded for; `null` for anonymous and trial listeners. */
  subject: string | null;
  /** Authorizes the audiobook's media for the subject and converts listening positions. */
  session: PlaybackSession;
  player: Player;
  /** Playing an audiobook with segments whose synthesis finally failed needs the listener's consent. */
  hasPlaybackConsent: boolean;
};

/** The conversion whose page the listener is on, which its Play and segment taps start. */
export type ShownConversion = {
  conversionId: string;
  /** The latest prepared version the page shows; `null` while the page has no prepared audiobook. */
  audiobook: PreparedAudiobook | null;
  /** The page's consent to skip segments without audio; once loaded, the loaded audiobook's applies. */
  hasPlaybackConsent: boolean;
  /** Whether Play and segment taps on the page can start playback. */
  canPlay: boolean;
};

export type PlayerHostSnapshot = {
  loaded: LoadedAudiobook | null;
  shown: ShownConversion | null;
  authorizationError: string | null;
};

/** The listener's account as far as playback is concerned. */
export type PlayerHostAccount =
  /** The stored session is being restored; who is listening is not known yet. */
  | { status: "restoring" }
  /** `subject` is the signed-in user, or `null` for anonymous and trial listeners. */
  | { status: "known"; subject: string | null };

export type PlayerHostServices = {
  createSession(request: PlaybackSessionRequest): PlaybackSession;
  createPlayer(session: PlaybackSession): Player;
  registerMediaSession(player: Player, title: string): (() => void) | undefined;
  /** Read at load time, so a load never uses an account state the host was not told about yet. */
  getAccount(): PlayerHostAccount;
  /** The listening position stored on this device, used for listeners without an account. */
  getLocalPosition(conversionId: string): PlaybackPosition | null;
};

/**
 * Holds the app's single player, so playback continues while the listener navigates, and decides
 * what it plays.
 *
 * A page reports the conversion it shows; the host loads its audiobook, paused, only while nothing
 * is loaded and the account is known. Only `play` and `playShown` start playback, which must run
 * within a user gesture. Playing the shown audiobook while another one is loaded saves and closes
 * the previous player. A newer version of the loaded audiobook with more audio, such as after a
 * retry, replaces it once playback pauses. A change of the signed-in user unloads the player.
 */
export class PlayerHost {
  private readonly services: PlayerHostServices;
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerHostSnapshot = { loaded: null, shown: null, authorizationError: null };
  /** The listener a page's consent was given by; restoring counts as anonymous. */
  private consentingSubject: string | null = null;
  /** A newer version of the loaded audiobook, waiting for playback to pause. */
  private pendingVersion: PlayableAudiobook | null = null;
  private releaseLoadedPlayer: (() => void) | undefined;

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

  /** Re-reads the account, after its restore finished or the signed-in user changed. */
  accountChanged = () => {
    const account = this.services.getAccount();
    const subject = account.status === "known" ? account.subject : null;

    // Media authorization and the listening position belong to the user the audiobook was loaded for.
    const { loaded, shown } = this.snapshot;
    if (account.status === "known" && loaded && loaded.subject !== subject) {
      this.unload();
    }
    // Another listener has not chosen to skip segments without audio.
    if (subject !== this.consentingSubject && shown) {
      this.update({ shown: { ...shown, hasPlaybackConsent: false } });
    }
    this.consentingSubject = subject;

    this.loadShownIntoEmptyPlayer();
  };

  /**
   * Reports the conversion whose page the listener is on and, once the page has it, its latest
   * prepared audiobook. Called again whenever that audiobook changes.
   */
  showConversion = (conversionId: string, audiobook?: PreparedAudiobook) => {
    const previous =
      this.snapshot.shown?.conversionId === conversionId ? this.snapshot.shown : null;
    this.update({
      shown: {
        conversionId,
        audiobook: audiobook ?? previous?.audiobook ?? null,
        hasPlaybackConsent: previous?.hasPlaybackConsent ?? false,
        canPlay: false,
      },
    });

    this.loadShownIntoEmptyPlayer();
  };

  /** The listener left the conversion's page; its consent to skip segments is forgotten. */
  hideConversion = (conversionId: string) => {
    if (this.snapshot.shown?.conversionId !== conversionId) {
      return;
    }

    this.update({ shown: null });
  };

  /**
   * Reports the latest version of the loaded audiobook, even while its page is not shown. It
   * replaces the loaded version once it is ready with more segments that have audio and playback is
   * paused.
   */
  updateLoadedAudiobook = (conversionId: string, latest: Audiobook) => {
    const { loaded } = this.snapshot;
    if (
      loaded?.conversionId !== conversionId ||
      latest.status !== "ready" ||
      countReadySegments(latest) <= countReadySegments(loaded.audiobook)
    ) {
      return;
    }

    this.pendingVersion = latest;
    this.swapInPendingVersionWhilePaused();
  };

  /**
   * Plays the loaded audiobook. Must be called from a user gesture: browsers only then allow audio
   * to start.
   */
  play = () => {
    const loaded = this.snapshot.loaded;
    if (!loaded?.hasPlaybackConsent) {
      return;
    }

    const { player, session } = loaded;
    // Start within the user gesture; browsers refuse audio that starts after awaiting.
    player.play();
    // Issued again on every Play, so access revoked while paused is noticed promptly.
    void session
      .authorizeMedia()
      .then(() => {
        if (this.snapshot.loaded?.player === player) {
          this.update({ authorizationError: null });
        }
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

  pause = () => {
    this.snapshot.loaded?.player.pause();
  };

  /**
   * Plays the shown audiobook, optionally from the start of a unit, loading it first when another
   * one is loaded. Must be called from a user gesture, like `play`.
   */
  playShown = (unitIndex?: number) => {
    const { shown } = this.snapshot;
    if (!shown?.canPlay) {
      return;
    }

    if (!this.isShownLoaded()) {
      this.load(this.createLoadRequest(shown));
    }
    if (unitIndex !== undefined) {
      this.snapshot.loaded?.player.seekToUnit(unitIndex);
    }
    this.play();
  };

  /** The listener chose to play the shown audiobook without its segments that have no audio. */
  consentToSkippingSegmentsWithoutAudio = () => {
    const { shown, loaded } = this.snapshot;
    if (!shown) {
      return;
    }

    this.update({
      shown: { ...shown, hasPlaybackConsent: true },
      loaded: loaded && this.isShownLoaded() ? { ...loaded, hasPlaybackConsent: true } : loaded,
    });
  };

  unload = () => {
    if (!this.snapshot.loaded) {
      return;
    }

    this.closeLoadedPlayer();
    this.update({ loaded: null, authorizationError: null });
  };

  private isShownLoaded() {
    const { shown, loaded } = this.snapshot;
    return shown !== null && shown.conversionId === loaded?.conversionId;
  }

  private load(request: LoadRequest) {
    this.closeLoadedPlayer();

    const session = this.services.createSession(request);
    const player = this.services.createPlayer(session);
    // Opening starts the media authorization that the report below shares with the engine.
    player.open();
    const unregisterMediaSession = this.services.registerMediaSession(
      player,
      request.audiobook.title,
    );
    // A pending version waits for playback to pause; a new player could start only from a gesture.
    const unsubscribeFromPlayer = player.subscribe(() => this.swapInPendingVersionWhilePaused());
    this.releaseLoadedPlayer = () => {
      unsubscribeFromPlayer();
      unregisterMediaSession?.();
    };
    this.update({
      loaded: {
        conversionId: request.conversionId,
        audiobook: request.audiobook,
        subject: request.subject,
        session,
        player,
        hasPlaybackConsent: request.hasPlaybackConsent,
      },
      authorizationError: null,
    });

    void session
      .authorizeMedia()
      .catch((error: unknown) =>
        this.reportAuthorizationError(player, error, "Playback authorization failed."),
      );
  }

  /** Loading never starts playback, so it needs no consent to skip segments without audio. */
  private loadShownIntoEmptyPlayer() {
    const { shown, loaded } = this.snapshot;
    // Waits for the account, whose listening position and media authorization the player needs.
    if (
      loaded ||
      !shown?.audiobook ||
      !hasLoadableAudio(shown.audiobook) ||
      this.services.getAccount().status === "restoring"
    ) {
      return;
    }

    this.load(this.createLoadRequest(shown));
  }

  private createLoadRequest(shown: ShownConversion): LoadRequest {
    const { conversionId, audiobook } = shown;
    if (!audiobook || !hasLoadableAudio(audiobook)) {
      throw new Error(`Audiobook ${conversionId} cannot be loaded before it is ready.`);
    }

    const account = this.services.getAccount();
    const subject = account.status === "known" ? account.subject : null;
    return {
      conversionId,
      audiobook,
      // Signed-in listeners keep their position on the server; others on the device.
      position:
        subject === null
          ? this.services.getLocalPosition(conversionId)
          : audiobook.playbackPosition,
      subject,
      hasPlaybackConsent: shown.hasPlaybackConsent || !hasSegmentsWithoutAudio(audiobook),
    };
  }

  private swapInPendingVersionWhilePaused() {
    const { loaded } = this.snapshot;
    const audiobook = this.pendingVersion;
    if (!loaded || !audiobook || loaded.player.getSnapshot().isPlaying) {
      return;
    }

    const position = loaded.session.listeningPositionOf(loaded.player.getSnapshot());
    // Only audiobooks with audio are loaded, so a player always reports a unit with audio.
    if (!position) {
      throw new Error("The loaded player reports no unit with audio.");
    }

    this.load({
      conversionId: loaded.conversionId,
      audiobook,
      position,
      subject: loaded.subject,
      // With every segment's audio now present, nothing is left to skip and so nothing to consent to.
      hasPlaybackConsent: loaded.hasPlaybackConsent || !hasSegmentsWithoutAudio(audiobook),
    });
  }

  private closeLoadedPlayer() {
    this.pendingVersion = null;
    const loaded = this.snapshot.loaded;
    if (!loaded) {
      return;
    }

    this.releaseLoadedPlayer?.();
    this.releaseLoadedPlayer = undefined;
    loaded.player.pause();
    loaded.player.close();
  }

  /** Reports a failure only while the player it concerns is still the loaded one. */
  private reportAuthorizationError(player: Player, error: unknown, fallbackMessage: string) {
    if (this.snapshot.loaded?.player !== player) {
      return;
    }

    this.update({ authorizationError: error instanceof Error ? error.message : fallbackMessage });
  }

  private update(value: Partial<PlayerHostSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    const { shown } = this.snapshot;
    if (shown) {
      this.snapshot.shown = { ...shown, canPlay: this.canPlayShown(shown) };
    }

    for (const listener of this.listeners) {
      listener();
    }
  }

  private canPlayShown({ audiobook, hasPlaybackConsent }: ShownConversion) {
    if (!audiobook || !hasLoadableAudio(audiobook)) {
      return false;
    }
    if (!hasSegmentsWithoutAudio(audiobook)) {
      return true;
    }

    // Once loaded, the loaded audiobook's consent applies.
    const { loaded } = this.snapshot;
    return loaded && this.isShownLoaded() ? loaded.hasPlaybackConsent : hasPlaybackConsent;
  }
}

type LoadRequest = {
  conversionId: string;
  audiobook: PlayableAudiobook;
  position: PlaybackPosition | null;
  subject: string | null;
  hasPlaybackConsent: boolean;
};

/**
 * Ready, and at least one segment has audio. A ready audiobook whose every segment failed has
 * nothing to play, so it is never loaded.
 */
function hasLoadableAudio(audiobook: PreparedAudiobook): audiobook is PlayableAudiobook {
  return audiobook.status === "ready" && countReadySegments(audiobook) > 0;
}

function hasSegmentsWithoutAudio(audiobook: PreparedAudiobook) {
  return audiobook.segments.some((segment) => segment.status !== "ready");
}

function countReadySegments(audiobook: { segments: PreparedAudiobook["segments"] }) {
  return audiobook.segments.filter((segment) => segment.status === "ready").length;
}
