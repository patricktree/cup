import { expect, test } from "vitest";

import { analyzeMp3, getSegmentByteLength } from "#src/audio-format.ts";

test("derives exact duration and removable tag boundaries from MP3 frames", () => {
  const frame = createMpeg2Layer3Frame();
  const id3v2 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  const id3v1 = new Uint8Array(128);

  id3v1.set([0x54, 0x41, 0x47]);

  const audio = concatenate(id3v2, frame, frame, id3v1);

  expect(analyzeMp3(audio)).toEqual({
    audioStart: id3v2.byteLength,
    audioEnd: id3v2.byteLength + frame.byteLength * 2,
    durationMilliseconds: 48,
  });
});

test("rejects non-frame bytes between MPEG audio frames", () => {
  const frame = createMpeg2Layer3Frame();

  expect(() => analyzeMp3(concatenate(frame, new Uint8Array([0])))).toThrow(
    "incomplete frame header",
  );
});

test("rejects a frame at a bitrate other than the configured one", () => {
  const frame = createMpeg2Layer3Frame();
  // bitrate index 0b1011 is 112 kbps in MPEG-2 Layer III, so the frame is 336 bytes
  const lowerBitrateFrame = new Uint8Array(336);

  lowerBitrateFrame.set([0xff, 0xf3, 0xb4, 0xc0]);

  expect(() => analyzeMp3(concatenate(frame, lowerBitrateFrame))).toThrow(
    "unexpected bitrate at byte 384: 112 kbps",
  );
});

test("rejects a padded frame", () => {
  const frame = createMpeg2Layer3Frame();
  // padding bit set, so the frame is 385 bytes
  const paddedFrame = new Uint8Array(385);

  paddedFrame.set([0xff, 0xf3, 0xc6, 0xc0]);

  expect(() => analyzeMp3(concatenate(frame, paddedFrame))).toThrow("padded frame at byte 384");
});

test("derives a segment byte length of 384 bytes per 24 ms frame from its settled duration", () => {
  expect(getSegmentByteLength(24)).toBe(384);
  expect(getSegmentByteLength(48_000)).toBe(768_000);
});

test("derives the byte length of analyzed audio from its analyzed duration", () => {
  const frame = createMpeg2Layer3Frame();
  const audio = concatenate(frame, frame, frame);

  expect(getSegmentByteLength(analyzeMp3(audio).durationMilliseconds)).toBe(audio.byteLength);
});

test("rejects a duration that is not a whole number of frames", () => {
  expect(() => getSegmentByteLength(25)).toThrow("whole number of 24 ms frames");
});

function createMpeg2Layer3Frame(): Uint8Array {
  const frame = new Uint8Array(384);

  frame.set([0xff, 0xf3, 0xc4, 0xc0]);

  return frame;
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}
