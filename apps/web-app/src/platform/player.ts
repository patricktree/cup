import { Capacitor } from "@capacitor/core";

/** A place on the timeline: an entry, that is a segment with audio, and an offset in its audio. */
export type TimelineLocation = { entryIndex: number; offsetMilliseconds: number };

/** A place as players report it: the current unit and the position on the whole audiobook. */
export type ReportedPosition = { currentUnitIndex: number; positionMilliseconds: number };

/** A player's state, on the whole-audiobook timeline. */
export type PlayerSnapshot = ReportedPosition & {
  /** Duration of the whole-audiobook timeline. */
  durationMilliseconds: number;
  isPlaying: boolean;
  isBuffering: boolean;
  error: string | null;
};

/**
 * An engine playing one loaded audiobook: the browser's audio elements or the native player. Its
 * playback session supplies the timeline, the restored position, authorization, and saves.
 */
export type Player = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PlayerSnapshot;
  open: () => void;
  close: () => void;
  play: () => void;
  pause: () => void;
  seekToUnit: (unitIndex: number) => void;
  seekTo: (positionMilliseconds: number) => void;
  /** Moves to the next or previous segment that has audio. */
  skip: (direction: 1 | -1) => void;
};

const MEDIA_SESSION_ACTIONS = ["play", "pause", "nexttrack", "previoustrack", "seekto"] as const;

/** Publishes the whole-audiobook timeline to the browser's media controls. */
export function registerPlayerMediaSession(player: Player, title: string) {
  if (Capacitor.isNativePlatform() || !navigator.mediaSession) return undefined;

  const { mediaSession } = navigator;
  mediaSession.metadata = new MediaMetadata({ title });
  mediaSession.setActionHandler("play", player.play);
  mediaSession.setActionHandler("pause", player.pause);
  mediaSession.setActionHandler("nexttrack", () => player.skip(1));
  mediaSession.setActionHandler("previoustrack", () => player.skip(-1));
  mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) player.seekTo(details.seekTime * 1_000);
  });

  const publishPosition = () => {
    const { durationMilliseconds, positionMilliseconds, isPlaying } = player.getSnapshot();
    mediaSession.playbackState = isPlaying ? "playing" : "paused";
    if (durationMilliseconds <= 0) return;

    mediaSession.setPositionState({
      duration: durationMilliseconds / 1_000,
      position: Math.min(positionMilliseconds, durationMilliseconds) / 1_000,
      playbackRate: 1,
    });
  };
  publishPosition();
  const unsubscribe = player.subscribe(publishPosition);

  return () => {
    unsubscribe();
    for (const action of MEDIA_SESSION_ACTIONS) mediaSession.setActionHandler(action, null);
    player.pause();
  };
}
