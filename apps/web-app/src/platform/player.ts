import { Capacitor } from "@capacitor/core";

import type { PlaybackPosition } from "@cup/web-app-api.routes";

import {
  AudiobookPlayer,
  type PlayableAudiobook,
  type PlayerSnapshot,
} from "#src/app/player/audiobook-player.js";
import { NativePlayer } from "#src/platform/native-player.js";

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

export function createPlayer(
  conversionId: string,
  audiobook: PlayableAudiobook,
  position: PlaybackPosition | null,
  subject: string | null,
): Player {
  return Capacitor.isNativePlatform()
    ? new NativePlayer(conversionId, audiobook, position, subject !== null)
    : AudiobookPlayer.forConversion(conversionId, audiobook, position, subject);
}

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
