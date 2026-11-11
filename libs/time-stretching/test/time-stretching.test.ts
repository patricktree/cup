import { expect, test } from "vitest";

import { stretchPcm } from "#src/time-stretching.ts";

const SAMPLE_RATE = 24_000;
const STRETCH_OPTIONS = { sampleRate: SAMPLE_RATE, speedFactor: 1.05 };

test("shortens PCM by the speed factor", async () => {
  const pcm = createTonePcm(SAMPLE_RATE * 2, 220);

  const stretched = await stretchPcm(pcm, STRETCH_OPTIONS);

  // 2 s at ×1.05 is 45,714 samples; allow 10 ms for Sonic's pitch-period granularity.
  expect(stretched.byteLength % 2).toBe(0);
  expect(Math.abs(stretched.byteLength / 2 - 45_714)).toBeLessThanOrEqual(SAMPLE_RATE / 100);
});

test("keeps the pitch of a pure tone", async () => {
  const pcm = createTonePcm(SAMPLE_RATE * 2, 220);

  const stretched = await stretchPcm(pcm, STRETCH_OPTIONS);

  // A 220 Hz tone crosses zero 440 times per second; a resampling speed-up would give 462.
  expect(countZeroCrossingsPerSecond(stretched)).toBeCloseTo(440, -1);
});

test("keeps audio shorter than Sonic's pitch analysis window", async () => {
  // Sonic holds back input until it has two of its longest pitch periods (738 samples at
  // 24 kHz), so 20 ms of audio comes out only when the stream is flushed.
  const pcm = createTonePcm(SAMPLE_RATE / 50, 220);

  const stretched = await stretchPcm(pcm, STRETCH_OPTIONS);

  // 20 ms at ×1.05 is 457 samples; Sonic's flush shortens such a fragment to about 283.
  expect(stretched.byteLength / 2).toBeGreaterThan(457 / 2);
  expect(stretched.byteLength / 2).toBeLessThanOrEqual(457);
});

test("stretches the same input to byte-identical output", async () => {
  const pcm = createTonePcm(SAMPLE_RATE, 330);

  const first = await stretchPcm(pcm, STRETCH_OPTIONS);
  const second = await stretchPcm(pcm, STRETCH_OPTIONS);

  expect(second).toEqual(first);
});

test.each([
  ["an odd byte length", new Uint8Array([0, 0, 0])],
  ["empty input", new Uint8Array()],
])("rejects PCM with %s", async (_description, pcm) => {
  await expect(stretchPcm(pcm, STRETCH_OPTIONS)).rejects.toThrow("complete signed 16-bit samples");
});

test.each([
  ["PCM sample rate", { ...STRETCH_OPTIONS, sampleRate: 0 }],
  ["PCM sample rate", { ...STRETCH_OPTIONS, sampleRate: -24_000 }],
  ["PCM sample rate", { ...STRETCH_OPTIONS, sampleRate: 24_000.5 }],
  ["speed factor", { ...STRETCH_OPTIONS, speedFactor: 0 }],
  ["speed factor", { ...STRETCH_OPTIONS, speedFactor: -1.05 }],
  ["speed factor", { ...STRETCH_OPTIONS, speedFactor: Number.NaN }],
])("rejects an invalid %s", async (expectedMessage, options) => {
  await expect(stretchPcm(new Uint8Array([0, 0]), options)).rejects.toThrow(expectedMessage);
});

test.each([
  ["sample rate", { ...STRETCH_OPTIONS, sampleRate: 999 }],
  ["speed factor", { ...STRETCH_OPTIONS, speedFactor: 21 }],
])("rejects a %s outside Sonic's supported range", async (_description, options) => {
  await expect(stretchPcm(new Uint8Array([0, 0]), options)).rejects.toThrow(
    "outside Sonic's supported range",
  );
});

function countZeroCrossingsPerSecond(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const sampleCount = pcm.byteLength / 2;
  let zeroCrossingCount = 0;

  for (let index = 1; index < sampleCount; index += 1) {
    const isPreviousNegative = view.getInt16((index - 1) * 2, true) < 0;
    const isCurrentNegative = view.getInt16(index * 2, true) < 0;

    if (isPreviousNegative !== isCurrentNegative) {
      zeroCrossingCount += 1;
    }
  }

  return zeroCrossingCount / (sampleCount / SAMPLE_RATE);
}

function createTonePcm(sampleCount: number, frequencyHertz: number): Uint8Array {
  const pcm = new Uint8Array(sampleCount * 2);
  const view = new DataView(pcm.buffer);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(
      Math.sin((index / SAMPLE_RATE) * frequencyHertz * Math.PI * 2) * 8_000,
    );

    view.setInt16(index * 2, sample, true);
  }

  return pcm;
}
