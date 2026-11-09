import { layOutConsecutively } from "@cup/conversion-contracts";
import type { NarrationTrack } from "@cup/listener-api.routes";

/** MPEG-1 Layer III, 128 kbps, 48 kHz, mono, no CRC and no padding: 384 bytes per frame. */
const SILENT_FRAME_HEADER = [0xff, 0xfb, 0x94, 0xc0];
const FRAME_BYTES = 384;
/** 1,152 samples at 48 kHz. */
const FRAME_MILLISECONDS = 24;

/**
 * Keeps a track's URL the same across responses, as a stored track's would be. The URLs live as
 * long as the gallery page and are never revoked; each test loads a new page.
 */
const trackUrlsByKey = new Map<string, string>();

/**
 * A narration track for stories: start offsets of the given unit durations and a URL of that much
 * silence, so the gallery's audio element really plays. `audiobook` tells the URLs of several
 * audiobooks apart.
 *
 * The URL is a `blob:` URL rather than a path a mock service worker handler answers: browsers seek
 * only in media whose server answers byte ranges, and MSW rebuilds every request in the page
 * without its `Range` header. Chromium plays on from a 200, but WebKit fails the whole track. A
 * blob URL never reaches the service worker, and every browser seeks in it. The fragment carries
 * `audiobook` so tests can tell the tracks apart by the audio element's `src`.
 */
export function createStoryNarrationTrack(
  unitDurationsMilliseconds: number[],
  audiobook = "story",
): NarrationTrack {
  const { startOffsets: startMilliseconds, totalLength: durationMilliseconds } =
    layOutConsecutively(unitDurationsMilliseconds);

  const key = `audiobook=${audiobook}&durationMilliseconds=${durationMilliseconds}`;
  let url = trackUrlsByKey.get(key);
  if (url === undefined) {
    const track = new Blob([encodeSilence(durationMilliseconds)], { type: "audio/mpeg" });
    url = `${URL.createObjectURL(track)}#${key}`;
    trackUrlsByKey.set(key, url);
  }

  return { url, durationMilliseconds, startMilliseconds };
}

/** A constant-bitrate MP3 of silence that lasts at least `durationMilliseconds`. */
function encodeSilence(durationMilliseconds: number): Uint8Array<ArrayBuffer> {
  const frameCount = Math.ceil(durationMilliseconds / FRAME_MILLISECONDS);
  // Zeroed side information encodes silence: every granule has no main data.
  const track = new Uint8Array(frameCount * FRAME_BYTES);
  for (let frame = 0; frame < frameCount; frame += 1) {
    track.set(SILENT_FRAME_HEADER, frame * FRAME_BYTES);
  }
  return track;
}
