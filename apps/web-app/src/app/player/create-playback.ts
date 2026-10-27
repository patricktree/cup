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
