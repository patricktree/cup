import { layOutConsecutively } from "@cup/conversion-contracts";
import type { NarrationTrack } from "@cup/listener-api.routes";

/** 8-bit unsigned PCM, mono, at the lowest sample rate Chromium plays. */
const SAMPLE_RATE = 3_000;
/** Unsigned 8-bit PCM is silent at its midpoint. */
const SILENT_SAMPLE = 0x80;
const WAV_HEADER_BYTES = 44;
/** Bytes per `String.fromCharCode` call, well below engines' argument limits. */
const BASE64_CHUNK_BYTES = 0x8000;

/**
 * Keeps a track's URL the same across responses, as a stored track's would be, and saves encoding
 * the same track again.
 */
const trackUrlsByKey = new Map<string, string>();

/**
 * A narration track for stories: start offsets of the given unit durations and a URL of that much
 * silence, so the gallery's audio element really plays. `audiobook` tells the URLs of several
 * audiobooks apart.
 *
 * The URL is a `data:` URL rather than a path a mock service worker handler answers: browsers seek
 * only in media whose server answers byte ranges, and MSW rebuilds every request in the page
 * without its `Range` header. Chromium plays on from a 200, but WebKit fails the whole track. A
 * `data:` URL never reaches the service worker, and every browser seeks in it.
 *
 * It is not a `blob:` URL: WebKit's GStreamer backend on Linux re-requests ranges of a track while
 * it detects the format, and its blob loader then intermittently delivers bytes from the wrong
 * offset or fails a range at the end of the blob, so about one in five loads failed. The track is
 * an uncompressed WAV rather than an MP3, whose detection re-requested the end of the file more.
 * The fragment carries `audiobook` so tests can tell the tracks apart by the audio element's
 * `src`.
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
    url = `data:audio/wav;base64,${encodeBase64(encodeSilence(durationMilliseconds))}#${key}`;
    trackUrlsByKey.set(key, url);
  }

  return { url, durationMilliseconds, startMilliseconds };
}

/** A PCM WAV of silence that lasts at least `durationMilliseconds`. */
function encodeSilence(durationMilliseconds: number): Uint8Array<ArrayBuffer> {
  const sampleCount = Math.ceil((durationMilliseconds * SAMPLE_RATE) / 1_000);
  const track = new Uint8Array(WAV_HEADER_BYTES + sampleCount).fill(SILENT_SAMPLE);
  const header = new DataView(track.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      header.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  header.setUint32(4, track.length - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  // Format chunk: its size, PCM, one channel, the sample rate, the byte rate, the bytes per sample
  // frame and the bits per sample.
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, SAMPLE_RATE, true);
  header.setUint32(28, SAMPLE_RATE, true);
  header.setUint16(32, 1, true);
  header.setUint16(34, 8, true);
  writeAscii(36, "data");
  header.setUint32(40, sampleCount, true);
  return track;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}
