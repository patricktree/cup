import type { Audiobook, PlaybackPosition } from "@cup/listener-api.routes";

import {
  NarrationTrackPlayer,
  type NarrationAudioElement,
  type Player,
} from "#src/app/player/narration-track-player.ts";
import {
  isPlayableAudiobook,
  type PlayableAudiobook,
  type PlaybackSession,
  type PlaybackSessionRequest,
  type PreparedAudiobook,
} from "#src/app/player/playback-session.ts";
import type { MediaMetadataInput } from "#src/platform/media-session.ts";

/** The one audiobook the app's player holds, with the player playing it. */
export type LoadedAudiobook = {
  conversionId: string;
  audiobook: PlayableAudiobook;
  /** The signed-in user the audiobook was loaded for; `null` for anonymous and trial listeners. */
  subject: string | null;
  player: Player;
};

/** The conversion whose page the listener is on, which its Play and segment taps start. */
export type ShownConversion = {
  conversionId: string;
  /** The latest prepared version the page shows; `null` while the page has no prepared audiobook. */
  audiobook: PreparedAudiobook | null;
  /** Whether Play and segment taps on the page can start playback: it has a narration track. */
  canPlay: boolean;
};

export type PlayerHostSnapshot = {
  loaded: LoadedAudiobook | null;
  shown: ShownConversion | null;
};

/** The listener's account as far as playback is concerned. */
export type PlayerHostAccount =
  /** The stored session is being restored; who is listening is not known yet. */
  | { status: "restoring" }
  /** `subject` is the signed-in user, or `null` for anonymous and trial listeners. */
  | { status: "known"; subject: string | null };

export type PlayerHostServices = {
  /** Called once: the host keeps the element for its own lifetime. */
  createAudioElement(): NarrationAudioElement;
  createSession(request: PlaybackSessionRequest): PlaybackSession;
  /** Shows the loaded audiobook in the system's media controls; the returned function clears it. */
  publishMediaMetadata(metadata: MediaMetadataInput): () => void;
  /** Read at load time, so a load never uses an account state the host was not told about yet. */
  getAccount(): PlayerHostAccount;
  /** The listening position stored on this device, used for listeners without an account. */
  getLocalPosition(conversionId: string): PlaybackPosition | null;
  /** Requests the audiobook again, for a newly signed narration track URL. */
  fetchAudiobook(conversionId: string): Promise<Audiobook>;
  /** The client clock, in milliseconds. */
  now(): number;
};

/**
 * How old a track URL may be before Play renews it. The signed URL stays valid for at least 24
 * hours after the server handed it out, by the server clock; half of that tolerates a skewed client
 * clock.
 */
const TRACK_URL_RENEWAL_AGE_MILLISECONDS = 12 * 60 * 60 * 1_000;
const RENEWAL_ERROR_MESSAGE = "The audio could not be loaded again. Press Play to try again.";

/**
 * Holds the app's one `<audio>` element and the audiobook loaded into it, so playback continues
 * while the listener navigates, and decides what it plays.
 *
 * A page reports the conversion it shows; the host loads its narration track, paused, only while
 * nothing is loaded and the account is known. Only `play` and `playShown` start playback, which
 * must run within a user gesture. Playing the shown audiobook while another one is loaded saves the
 * previous one and sets the new track on the same element. A change of the signed-in user unloads
 * the element.
 */
export class PlayerHost {
  private readonly services: PlayerHostServices;
  private readonly element: NarrationAudioElement;
  private readonly listeners = new Set<() => void>();
  private snapshot: PlayerHostSnapshot = { loaded: null, shown: null };
  private clearMediaMetadata: (() => void) | undefined;
  /** When the client received the shown audiobook, whose track URL a load uses. */
  private shownAudiobookReceivedAt = 0;
  /** When the client received the loaded track's URL. */
  private trackUrlReceivedAt = 0;
  /** The renewal Play is waiting for; Pause and unloading cancel it. */
  private pendingRenewal: symbol | null = null;

  constructor(services: PlayerHostServices) {
    this.services = services;
    this.element = services.createAudioElement();
    // Only the duration is needed before Play; the track itself streams once playback starts.
    this.element.preload = "metadata";
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

    // The listening position belongs to the user the audiobook was loaded for.
    const { loaded } = this.snapshot;
    if (account.status === "known" && loaded && loaded.subject !== subject) {
      this.unload();
    }

    this.loadShownIntoEmptyPlayer();
  };

  /**
   * Reports the conversion whose page the listener is on and, once the page has it, its latest
   * prepared audiobook. Called again whenever that audiobook changes.
   */
  showConversion = (conversionId: string, audiobook?: PreparedAudiobook) => {
    const previous =
      this.snapshot.shown?.conversionId === conversionId ? this.snapshot.shown : null;
    const shownAudiobook = audiobook ?? previous?.audiobook ?? null;
    if (shownAudiobook !== previous?.audiobook) {
      this.shownAudiobookReceivedAt = this.services.now();
    }
    this.update({
      shown: {
        conversionId,
        audiobook: shownAudiobook,
        canPlay: shownAudiobook !== null && isPlayableAudiobook(shownAudiobook),
      },
    });

    this.loadShownIntoEmptyPlayer();
  };

  /** The listener left the conversion's page. */
  hideConversion = (conversionId: string) => {
    if (this.snapshot.shown?.conversionId !== conversionId) {
      return;
    }

    this.update({ shown: null });
  };

  /**
   * Plays the loaded audiobook. Must be called from a user gesture: browsers only then allow audio
   * to start.
   *
   * When the track URL is older than the renewal age, or the previous playback ended in a media
   * error, Play first requests the audiobook again and sets its newly signed URL at the same
   * position. Only that path plays after an await, which browsers allow on an element an earlier
   * gesture started; if one refuses, the next Play starts the renewed track within its gesture.
   */
  play = () => {
    const { loaded } = this.snapshot;
    if (!loaded || this.pendingRenewal) {
      return;
    }

    const trackUrlAge = this.services.now() - this.trackUrlReceivedAt;
    if (this.element.error || trackUrlAge > TRACK_URL_RENEWAL_AGE_MILLISECONDS) {
      void this.renewTrackUrlAndPlay(loaded);
      return;
    }

    loaded.player.play();
  };

  pause = () => {
    this.pendingRenewal = null;
    this.snapshot.loaded?.player.pause();
  };

  /**
   * Plays the shown audiobook, optionally from the start of a unit, loading it first when another
   * one is loaded. Must be called from a user gesture, like `play`.
   */
  playShown = (unitIndex?: number) => {
    const player = this.loadShown();
    if (!player) {
      return;
    }

    if (unitIndex !== undefined) {
      player.seekToUnit(unitIndex);
    }
    this.play();
  };

  /**
   * Loads the shown audiobook, paused, when another one is loaded, and returns its player, so the
   * player sheet can seek it before it plays. Returns `null` while the shown audiobook has no
   * narration track.
   */
  loadShown = (): Player | null => {
    const { shown } = this.snapshot;
    if (!shown?.canPlay) {
      return null;
    }

    if (!this.isShownLoaded()) {
      this.load(shown);
    }
    return this.snapshot.loaded?.player ?? null;
  };

  /** Saves the position and empties the element: pause, remove its source, and load nothing. */
  unload = () => {
    if (!this.snapshot.loaded) {
      return;
    }

    this.closeLoadedPlayer();
    this.element.removeAttribute("src");
    this.element.load();
    this.update({ loaded: null });
  };

  private isShownLoaded() {
    const { shown, loaded } = this.snapshot;
    return shown !== null && shown.conversionId === loaded?.conversionId;
  }

  private load({ conversionId, audiobook }: ShownConversion) {
    if (!audiobook || !isPlayableAudiobook(audiobook)) {
      throw new Error(`Audiobook ${conversionId} cannot be loaded without a narration track.`);
    }

    this.closeLoadedPlayer();

    const account = this.services.getAccount();
    const subject = account.status === "known" ? account.subject : null;
    const session = this.services.createSession({
      conversionId,
      audiobook,
      // Signed-in listeners keep their position on the server; others on the device.
      position:
        subject === null
          ? this.services.getLocalPosition(conversionId)
          : audiobook.playbackPosition,
      subject,
    });
    const player = new NarrationTrackPlayer(session, this.element);
    this.trackUrlReceivedAt = this.shownAudiobookReceivedAt;
    this.clearMediaMetadata = this.services.publishMediaMetadata({
      title: audiobook.title,
      artworkUrl: audiobook.coverImage?.url,
    });
    this.update({ loaded: { conversionId, audiobook, subject, player } });
  }

  private async renewTrackUrlAndPlay(loaded: LoadedAudiobook) {
    const renewal = Symbol("renewal");
    this.pendingRenewal = renewal;

    let audiobook: Audiobook | null;
    try {
      audiobook = await this.services.fetchAudiobook(loaded.conversionId);
    } catch {
      // The request layer reports the failure itself; the player shows that Play did not start.
      audiobook = null;
    }
    // Pause, unloading or loading another audiobook during the request cancelled the renewal.
    if (this.pendingRenewal !== renewal) {
      return;
    }
    this.pendingRenewal = null;

    // Without a narration track the audiobook is no longer playable, e.g. after a retry.
    if (audiobook?.status !== "ready" || !audiobook.narrationTrack) {
      loaded.player.showError(RENEWAL_ERROR_MESSAGE);
      return;
    }

    this.trackUrlReceivedAt = this.services.now();
    loaded.player.replaceTrackUrl(audiobook.narrationTrack.url);
    loaded.player.play();
  }

  private loadShownIntoEmptyPlayer() {
    const { shown, loaded } = this.snapshot;
    // Waits for the account, whose listening position the player restores.
    if (loaded || !shown?.canPlay || this.services.getAccount().status === "restoring") {
      return;
    }

    this.load(shown);
  }

  private closeLoadedPlayer() {
    this.pendingRenewal = null;
    this.snapshot.loaded?.player.close();
    this.clearMediaMetadata?.();
    this.clearMediaMetadata = undefined;
  }

  private update(value: Partial<PlayerHostSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
