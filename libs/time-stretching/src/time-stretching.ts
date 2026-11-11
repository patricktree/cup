const PCM_SAMPLE_BYTE_LENGTH = 2;
// Must match the capacity compiled into the narrow Sonic bridge.
const CHUNK_SAMPLE_COUNT = 4_608;
// Sonic silently clamps values outside these ranges (SONIC_MIN_* and SONIC_MAX_* in sonic.h).
const SONIC_SAMPLE_RATE_RANGE = { min: 1_000, max: 500_000 };
const SONIC_SPEED_RANGE = { min: 0.05, max: 20 };
// Sonic's lowest detected pitch (SONIC_MIN_PITCH in sonic.h); it holds back two periods of it.
const SONIC_MIN_PITCH_HERTZ = 65;

/** Configures the time-stretch of mono signed 16-bit little-endian PCM. */
export type StretchOptions = {
  sampleRate: number;
  /** Output duration is the input duration divided by this factor. */
  speedFactor: number;
};

type StretcherExports = {
  memory: WebAssembly.Memory;
  initialize(): void;
  stretcher_create(sampleRate: number, speed: number): number;
  stretcher_flush(stretcher: number): number;
  stretcher_free(stretcher: number): void;
  stretcher_get_pcm(stretcher: number): number;
  stretcher_read(stretcher: number): number;
  stretcher_write(stretcher: number, sampleCount: number): number;
};

/** Time-stretches mono signed 16-bit little-endian PCM, keeping its pitch. */
export async function stretchPcm(pcm: Uint8Array, options: StretchOptions): Promise<Uint8Array> {
  if (!Number.isInteger(options.sampleRate) || options.sampleRate <= 0) {
    throw new Error(`PCM sample rate must be a positive integer: ${options.sampleRate}`);
  }

  if (!Number.isFinite(options.speedFactor) || options.speedFactor <= 0) {
    throw new Error(
      `Time-stretch speed factor must be a finite number greater than zero: ${options.speedFactor}`,
    );
  }

  if (pcm.byteLength === 0 || pcm.byteLength % PCM_SAMPLE_BYTE_LENGTH !== 0) {
    throw new Error(
      `PCM audio byte length must contain complete signed 16-bit samples: ${pcm.byteLength}`,
    );
  }

  assertWithinRange(options.sampleRate, SONIC_SAMPLE_RATE_RANGE, "PCM sample rate");
  assertWithinRange(options.speedFactor, SONIC_SPEED_RANGE, "Time-stretch speed factor");

  const wasm = await instantiateStretcher();
  const stretcher = wasm.stretcher_create(options.sampleRate, options.speedFactor);

  if (stretcher === 0) {
    throw new Error("Sonic time stretcher initialization failed");
  }

  try {
    return stretch(wasm, stretcher, pcm, options);
  } finally {
    wasm.stretcher_free(stretcher);
  }
}

async function instantiateStretcher(): Promise<StretcherExports> {
  const { default: timeStretcherModule } = await import("#src/time-stretcher.wasm");
  const instance = await WebAssembly.instantiate(timeStretcherModule, {
    env: {
      emscripten_notify_memory_growth() {},
    },
  });
  const { exports } = instance;
  const { memory } = exports;

  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error("Sonic time stretcher does not export WebAssembly memory");
  }

  const wasm = {
    memory,
    initialize() {
      callVoidExport(exports, "_initialize");
    },
    stretcher_create(sampleRate, speed) {
      return callNumberExport(exports, "stretcher_create", sampleRate, speed);
    },
    stretcher_flush(stretcher) {
      return callNumberExport(exports, "stretcher_flush", stretcher);
    },
    stretcher_free(stretcher) {
      callVoidExport(exports, "stretcher_free", stretcher);
    },
    stretcher_get_pcm(stretcher) {
      return callNumberExport(exports, "stretcher_get_pcm", stretcher);
    },
    stretcher_read(stretcher) {
      return callNumberExport(exports, "stretcher_read", stretcher);
    },
    stretcher_write(stretcher, sampleCount) {
      return callNumberExport(exports, "stretcher_write", stretcher, sampleCount);
    },
  } satisfies StretcherExports;

  wasm.initialize();

  return wasm;
}

function stretch(
  wasm: StretcherExports,
  stretcher: number,
  pcm: Uint8Array,
  options: StretchOptions,
): Uint8Array {
  const bufferPointer = wasm.stretcher_get_pcm(stretcher);

  if (bufferPointer === 0) {
    throw new Error("Sonic time stretcher did not provide a PCM buffer");
  }

  // Sonic's flush squeezes the pitch periods it still holds back and fades them into silence,
  // cutting up to about 13 ms off a segment's end. Silence past the end turns those periods into
  // ordinary input; the output is trimmed back to the segment's stretched length below. The
  // padding covers two of Sonic's longest pitch periods of output, so it scales with a speed-up.
  const paddingSampleCount = Math.ceil(
    ((2 * options.sampleRate) / SONIC_MIN_PITCH_HERTZ) * Math.max(1, options.speedFactor),
  );
  const paddedPcm = new Uint8Array(pcm.byteLength + paddingSampleCount * PCM_SAMPLE_BYTE_LENGTH);
  paddedPcm.set(pcm);

  const stretchedChunks: Uint8Array[] = [];
  let stretchedByteLength = 0;

  for (
    let byteOffset = 0;
    byteOffset < paddedPcm.byteLength;
    byteOffset += CHUNK_SAMPLE_COUNT * PCM_SAMPLE_BYTE_LENGTH
  ) {
    const chunk = paddedPcm.subarray(
      byteOffset,
      Math.min(byteOffset + CHUNK_SAMPLE_COUNT * PCM_SAMPLE_BYTE_LENGTH, paddedPcm.byteLength),
    );

    new Uint8Array(wasm.memory.buffer, bufferPointer, chunk.byteLength).set(chunk);
    assertSuccessStatus(
      wasm.stretcher_write(stretcher, chunk.byteLength / PCM_SAMPLE_BYTE_LENGTH),
      "writing",
    );
    stretchedByteLength += readStretchedChunks(stretchedChunks, wasm, stretcher, bufferPointer);
  }

  // Sonic holds back the last pitch periods until it is flushed; without this the padding is lost
  // and, with it, the segment's end.
  assertSuccessStatus(wasm.stretcher_flush(stretcher), "flushing");
  stretchedByteLength += readStretchedChunks(stretchedChunks, wasm, stretcher, bufferPointer);

  const stretchedSampleCount = Math.round(
    pcm.byteLength / PCM_SAMPLE_BYTE_LENGTH / options.speedFactor,
  );
  const stretchedSegmentByteLength = stretchedSampleCount * PCM_SAMPLE_BYTE_LENGTH;

  if (stretchedByteLength < stretchedSegmentByteLength) {
    throw new Error(
      `Sonic time stretcher returned ${stretchedByteLength / PCM_SAMPLE_BYTE_LENGTH} samples, fewer than the segment's stretched length of ${stretchedSampleCount}`,
    );
  }

  const stretched = new Uint8Array(stretchedSegmentByteLength);
  let outputOffset = 0;

  for (const chunk of stretchedChunks) {
    const remainingByteLength = stretchedSegmentByteLength - outputOffset;

    if (remainingByteLength === 0) {
      break;
    }

    const keptChunk = chunk.subarray(0, Math.min(chunk.byteLength, remainingByteLength));

    stretched.set(keptChunk, outputOffset);
    outputOffset += keptChunk.byteLength;
  }

  return stretched;
}

function readStretchedChunks(
  chunks: Uint8Array[],
  wasm: StretcherExports,
  stretcher: number,
  bufferPointer: number,
): number {
  let byteLength = 0;

  for (;;) {
    const sampleCount = wasm.stretcher_read(stretcher);

    if (sampleCount === 0) {
      return byteLength;
    }

    // Do not expose adjacent WASM memory if the bridge ever violates its buffer capacity.
    if (sampleCount < 0 || sampleCount > CHUNK_SAMPLE_COUNT) {
      throw new Error(`Sonic time stretcher reading failed with status ${sampleCount}`);
    }

    const chunkByteLength = sampleCount * PCM_SAMPLE_BYTE_LENGTH;

    chunks.push(new Uint8Array(wasm.memory.buffer, bufferPointer, chunkByteLength).slice());
    byteLength += chunkByteLength;
  }
}

function assertSuccessStatus(status: number, operation: string): void {
  if (status !== 0) {
    throw new Error(`Sonic time stretcher ${operation} failed with status ${status}`);
  }
}

function assertWithinRange(value: number, range: { min: number; max: number }, name: string): void {
  if (value < range.min || value > range.max) {
    throw new Error(
      `${name} is outside Sonic's supported range of ${range.min} to ${range.max}: ${value}`,
    );
  }
}

function callNumberExport(
  exports: WebAssembly.Exports,
  name: string,
  ...parameters: number[]
): number {
  const exportedFunction = exports[name];

  if (typeof exportedFunction !== "function") {
    throw new Error(`Sonic time stretcher does not export function ${name}`);
  }

  const result: unknown = exportedFunction(...parameters);

  if (typeof result !== "number") {
    throw new Error(`Sonic time stretcher function ${name} did not return a number`);
  }

  return result;
}

function callVoidExport(exports: WebAssembly.Exports, name: string, ...parameters: number[]): void {
  const exportedFunction = exports[name];

  if (typeof exportedFunction !== "function") {
    throw new Error(`Sonic time stretcher does not export function ${name}`);
  }

  exportedFunction(...parameters);
}
