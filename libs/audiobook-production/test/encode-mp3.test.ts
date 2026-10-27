import { expect, test } from "vitest";

import { encodePcmAsMp3 } from "@cup/mp3-encoding";

import { analyzeMp3, AUDIO_FORMAT } from "#src/audio-format.ts";

const ENCODING_OPTIONS = {
  bitrateKilobitsPerSecond: AUDIO_FORMAT.bitrateKilobitsPerSecond,
  sampleRate: AUDIO_FORMAT.sampleRate,
};

test("encodes Gemini-format PCM as valid 24 kHz mono MP3 frames", async () => {
  const sampleCount = AUDIO_FORMAT.sampleRate / 10;
  const pcm = new Uint8Array(sampleCount * 2);
  const view = new DataView(pcm.buffer);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(
      Math.sin((index / AUDIO_FORMAT.sampleRate) * 440 * Math.PI * 2) * 8_000,
    );

    view.setInt16(index * 2, sample, true);
  }

  const mp3 = await encodePcmAsMp3(pcm, ENCODING_OPTIONS);
  const analysis = analyzeMp3(mp3);

  expect(analysis.audioStart).toBe(0);
  expect(analysis.audioEnd).toBe(mp3.byteLength);
  expect(analysis.durationMilliseconds).toBeGreaterThanOrEqual(100);
});

test("rejects PCM containing incomplete samples", async () => {
  await expect(encodePcmAsMp3(new Uint8Array([0]), ENCODING_OPTIONS)).rejects.toThrow(
    "complete signed 16-bit samples",
  );
});
