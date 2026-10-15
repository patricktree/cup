import { Capacitor } from "@capacitor/core";

import { AudiobookPlayer } from "#src/app/player/audiobook-player.js";
import {
  PlaybackSession,
  type PlaybackSessionRequest,
  type PlaybackSessionServices,
} from "#src/app/player/playback-session.js";
import silenceUrl from "#src/app/player/silence.wav?no-inline";
import {
  getResourceAccountSession,
  refreshPlaybackAuthorization,
} from "#src/auth/account-session.js";
import { savePlaybackPosition } from "#src/data-fetching/reader.js";
import { NativePlayer } from "#src/platform/native-player.js";
import type { Player } from "#src/platform/player.js";

/** Connects a loaded audiobook's playback session to account sign-in and position storage. */
export function createPlaybackSession(request: PlaybackSessionRequest): PlaybackSession {
  const services: PlaybackSessionServices = {
    getAccount: async () => {
      const session = await getResourceAccountSession();
      return session ? { subject: session.user.id, accessToken: session.access_token } : null;
    },
    issueMediaCookie: () => refreshPlaybackAuthorization(),
    savePosition: (position, subject) =>
      savePlaybackPosition(request.conversionId, position, subject),
    now: () => Date.now(),
  };
  return new PlaybackSession(request, services);
}

/** Selects the engine for this platform: the browser's audio elements or the native player. */
export function createPlayer(session: PlaybackSession): Player {
  return Capacitor.isNativePlatform()
    ? new NativePlayer(session)
    : new AudiobookPlayer(session, {
        createAudioElement: createCredentialedAudioElement,
        silenceUrl,
      });
}

function createCredentialedAudioElement() {
  const element = new Audio();
  element.preload = "auto";
  // Sends the media cookie, or a trial's grant cookie, with every segment request.
  element.crossOrigin = "use-credentials";
  return element;
}
