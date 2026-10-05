import { Capacitor } from "@capacitor/core";

import type { PlaybackPosition } from "@cup/web-app-api.routes";

import {
  ProgressivePlayer,
  type PreparedAudiobook,
  type PlayerSnapshot,
} from "#src/app/player/progressive-player.js";
import { NativePlayer } from "#src/platform/native-player.js";

export type Player = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PlayerSnapshot;
  attach: (audio: HTMLAudioElement | null) => void;
  play: () => void;
  pause: () => void;
  seek: (unitIndex: number) => void;
  retry: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: () => void;
  onMediaError?: () => void;
};

export function createPlayer(
  conversionId: string,
  audiobook: PreparedAudiobook,
  position: PlaybackPosition | null,
  subject: string | null,
): Player {
  return Capacitor.isNativePlatform()
    ? new NativePlayer(conversionId, audiobook, position, subject !== null)
    : ProgressivePlayer.forConversion(conversionId, audiobook, position, subject);
}

export function registerPlayerMediaSession(player: Player, title: string) {
  if (Capacitor.isNativePlatform() || !navigator.mediaSession) return undefined;

  navigator.mediaSession.metadata = new MediaMetadata({ title });
  navigator.mediaSession.setActionHandler("play", player.play);
  navigator.mediaSession.setActionHandler("pause", player.pause);
  navigator.mediaSession.setActionHandler("nexttrack", () =>
    player.seek(player.getSnapshot().currentUnitIndex + 1),
  );
  navigator.mediaSession.setActionHandler("previoustrack", () =>
    player.seek(player.getSnapshot().currentUnitIndex - 1),
  );

  return () => {
    for (const action of ["play", "pause", "nexttrack", "previoustrack"] as const)
      navigator.mediaSession.setActionHandler(action, null);
    player.pause();
  };
}
