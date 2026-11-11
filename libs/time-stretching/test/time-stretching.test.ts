import { expect, test } from "vitest";

import { stretchPcm } from "#src/time-stretching.ts";

const SAMPLE_RATE = 24_000;
const STRETCH_OPTIONS = { sampleRate: SAMPLE_RATE, speedFactor: 1.05 };

test.each([
  { sampleCount: SAMPLE_RATE * 2, stretchedSampleCount: 45_714 },
  { sampleCount: SAMPLE_RATE * 2 + 137, stretchedSampleCount: 45_845 },
  { sampleCount: SAMPLE_RATE * 3 + 1_000, stretchedSampleCount: 69_524 },
])(
  "shortens $sampleCount samples of PCM by the speed factor to $stretchedSampleCount",
  async ({ sampleCount, stretchedSampleCount }) => {
    const pcm = createTonePcm(sampleCount, 220);

    const stretched = await stretchPcm(pcm, STRETCH_OPTIONS);

    expect(stretched.byteLength / 2).toBe(stretchedSampleCount);
  },
);

test("keeps the pitch of a pure tone", async () => {
  const pcm = createTonePcm(SAMPLE_RATE * 2, 220);

  const stretched = await stretchPcm(pcm, STRETCH_OPTIONS);

  // A 220 Hz tone crosses zero 440 times per second; a resampling speed-up would give 462.
  expect(countZeroCrossingsPerSecond(stretched)).toBeCloseTo(440, -1);
});

test("keeps audio shorter than Sonic's pitch analysis window", async () => {
  // Sonic holds back input until it has two of its longest pitch periods (738 samples at
  // 24 kHz), so 20 ms of audio comes out only once the stream is padded and flushed.
  const pcm = createTonePcm(SAMPLE_RATE / 50, 1_500);

  const stretched = await stretchPcm(pcm, STRETCH_OPTIONS);

  // 20 ms at ×1.05 is 457 samples.
  expect(stretched.byteLength / 2).toBe(457);
  expect(countHighPitchedSamples(stretched)).toBeGreaterThanOrEqual(457 * 0.85);
});

test("keeps a short distinctive tail at the end of a segment", async () => {
  // Sonic's flush squeezes the pitch periods it holds back and fades them into silence, which
  // cost about half of this tail before the stretcher padded the segment with silence.
  const body = createTonePcm(SAMPLE_RATE * 2, 220);
  const tail = createTonePcm(SAMPLE_RATE / 50, 1_500);

  const stretchedBody = await stretchPcm(body, STRETCH_OPTIONS);
  const stretched = await stretchPcm(concatenatePcm(body, tail), STRETCH_OPTIONS);

  // The 20 ms tail at ×1.05 is 457 samples; Sonic removes whole pitch periods, so the tail's
  // content may fall 15% short.
  expect(stretched.byteLength / 2 - stretchedBody.byteLength / 2).toBe(457);
  expect(countHighPitchedSamples(stretched)).toBeGreaterThanOrEqual(457 * 0.85);
  // The tail ends the output rather than the body or silence.
  expect(
    countHighPitchedSamples(stretched.subarray(-(SAMPLE_RATE / 100) * 2)),
  ).toBeGreaterThanOrEqual((SAMPLE_RATE / 100) * 0.5);
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
  { sampleRate: 999, speedFactor: 1.05 },
  { sampleRate: 500_001, speedFactor: 1.05 },
  { sampleRate: SAMPLE_RATE, speedFactor: 0.049 },
  { sampleRate: SAMPLE_RATE, speedFactor: 20.001 },
])(
  "rejects a sample rate of $sampleRate Hz and speed factor of $speedFactor outside Sonic's supported range",
  async (options) => {
    await expect(stretchPcm(new Uint8Array([0, 0]), options)).rejects.toThrow(
      "outside Sonic's supported range",
    );
  },
);

test.each([
  { sampleRate: 1_000, speedFactor: 1.05 },
  { sampleRate: 500_000, speedFactor: 1.05 },
  { sampleRate: SAMPLE_RATE, speedFactor: 0.05 },
  { sampleRate: SAMPLE_RATE, speedFactor: 20 },
])(
  "accepts a sample rate of $sampleRate Hz and speed factor of $speedFactor at the edge of Sonic's supported range",
  async (options) => {
    const pcm = createTonePcm(SAMPLE_RATE, 220);

    const stretched = await stretchPcm(pcm, options);

    expect(stretched.byteLength / 2).toBe(Math.round(SAMPLE_RATE / options.speedFactor));
  },
);

function concatenatePcm(...parts: Uint8Array[]): Uint8Array {
  const pcm = new Uint8Array(parts.reduce((byteLength, part) => byteLength + part.byteLength, 0));
  let byteOffset = 0;

  for (const part of parts) {
    pcm.set(part, byteOffset);
    byteOffset += part.byteLength;
  }

  return pcm;
}

// Counts the samples in 1 ms blocks that cross zero at least twice at a tone's amplitude: a 1,500 Hz
// tone does, a 220 Hz tone, which crosses zero every 2.3 ms, does not.
function countHighPitchedSamples(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const sampleCount = pcm.byteLength / 2;
  const blockSampleCount = SAMPLE_RATE / 1_000;
  let highPitchedSampleCount = 0;

  for (
    let blockStart = 0;
    blockStart + blockSampleCount <= sampleCount;
    blockStart += blockSampleCount
  ) {
    let zeroCrossingCount = 0;
    let peak = 0;

    for (let index = blockStart + 1; index < blockStart + blockSampleCount; index += 1) {
      const previousSample = view.getInt16((index - 1) * 2, true);
      const sample = view.getInt16(index * 2, true);

      if (previousSample < 0 !== sample < 0) {
        zeroCrossingCount += 1;
      }

      peak = Math.max(peak, Math.abs(sample));
    }

    if (zeroCrossingCount >= 2 && peak > 4_000) {
      highPitchedSampleCount += blockSampleCount;
    }
  }

  return highPitchedSampleCount;
}

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
