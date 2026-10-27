import { http, HttpResponse } from "msw";

import type { NarrationTrack } from "@cup/listener-api.routes";

const NARRATION_TRACK_PATH = "/__story/narration-track.mp3";
/** MPEG-1 Layer III, 128 kbps, 48 kHz, mono, no CRC and no padding: 384 bytes per frame. */
const SILENT_FRAME_HEADER = [0xff, 0xfb, 0x94, 0xc0];
const FRAME_BYTES = 384;
/** 1,152 samples at 48 kHz. */
const FRAME_MILLISECONDS = 24;

/**
 * A narration track for stories: start offsets of the given unit durations and a URL that the
 * handler below answers with that much silence, so the gallery's audio element really plays.
 * `audiobook` tells the URLs of several audiobooks apart.
 */
export function createStoryNarrationTrack(
  unitDurationsMilliseconds: number[],
  audiobook = "story",
): NarrationTrack {
  const startMilliseconds: number[] = [];
  let durationMilliseconds = 0;
  for (const unitDurationMilliseconds of unitDurationsMilliseconds) {
    startMilliseconds.push(durationMilliseconds);
    durationMilliseconds += unitDurationMilliseconds;
  }

  const url = new URL(NARRATION_TRACK_PATH, window.location.origin);
  url.searchParams.set("audiobook", audiobook);
  url.searchParams.set("durationMilliseconds", String(durationMilliseconds));
  return { url: url.href, durationMilliseconds, startMilliseconds };
}

/**
 * Serves the silence a story narration track's URL asks for, as a constant-bitrate MP3. It answers
 * byte ranges: browsers seek only in media whose server does.
 */
export const storyNarrationTrackHandler = http.get(NARRATION_TRACK_PATH, ({ request }) => {
  const durationMilliseconds = Number(
    new URL(request.url).searchParams.get("durationMilliseconds"),
  );
  const frameCount = Math.ceil(durationMilliseconds / FRAME_MILLISECONDS);
  // Zeroed side information encodes silence: every granule has no main data.
  const track = new Uint8Array(frameCount * FRAME_BYTES);
  for (let frame = 0; frame < frameCount; frame += 1) {
    track.set(SILENT_FRAME_HEADER, frame * FRAME_BYTES);
  }

  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("Range") ?? "");
  if (!range) {
    return new HttpResponse(track, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Type": "audio/mpeg",
        "Content-Length": String(track.byteLength),
      },
    });
  }

  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : track.byteLength - 1, track.byteLength - 1);
  const body = track.slice(start, end + 1);
  return new HttpResponse(body, {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Type": "audio/mpeg",
      "Content-Length": String(body.byteLength),
      "Content-Range": `bytes ${start}-${end}/${track.byteLength}`,
    },
  });
});
