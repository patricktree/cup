import {
  PlaybackSession,
  type PlaybackSessionRequest,
  type PlaybackSessionServices,
} from "#src/app/player/playback-session.js";
import { savePlaybackPosition } from "#src/data-fetching/reader.js";

/** Connects a loaded audiobook's playback session to position storage. */
export function createPlaybackSession(request: PlaybackSessionRequest): PlaybackSession {
  const services: PlaybackSessionServices = {
    savePosition: (position, subject) =>
      savePlaybackPosition(request.conversionId, position, subject),
    now: () => Date.now(),
    setRetryTimer: (callback, delayMilliseconds) => {
      const timeout = setTimeout(callback, delayMilliseconds);
      return () => clearTimeout(timeout);
    },
    onReconnect: listenForReconnect,
  };
  return new PlaybackSession(request, services);
}

/**
 * The player host's one audio element. It sets no `crossOrigin`: the narration track's signed URL
 * carries its own authorization, so the request needs no cookie.
 */
export function createNarrationAudioElement(): HTMLAudioElement {
  return new Audio();
}

/**
 * Calls `callback` when the connection may be back: the device went online, or the app returned to
 * the foreground. Android can cut a backgrounded app's network access, so a save sent while the app
 * was in the background or the screen was locked can fail to resolve the API host (CUP-71).
 */
function listenForReconnect(callback: () => void): () => void {
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      callback();
    }
  };
  globalThis.addEventListener("online", callback);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    globalThis.removeEventListener("online", callback);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
