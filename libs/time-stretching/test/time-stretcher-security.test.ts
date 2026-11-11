import crypto from "node:crypto";
import fs from "node:fs";
import { expect, test } from "vitest";

const EXPECTED_TIME_STRETCHER_SHA256 =
  "c923e7b662bf58c30b9a6eb3cdeabf3fe849ccabfb0a91148665673e2bca2353";

test("uses the reviewed time stretcher artifact", () => {
  const bytes = fs.readFileSync(new URL("../src/time-stretcher.wasm", import.meta.url));

  expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(
    EXPECTED_TIME_STRETCHER_SHA256,
  );
});

test("limits the time stretcher artifact to reviewed imports", () => {
  const bytes = fs.readFileSync(new URL("../src/time-stretcher.wasm", import.meta.url));
  const module = new WebAssembly.Module(bytes);

  expect(WebAssembly.Module.imports(module)).toEqual([
    {
      kind: "function",
      module: "env",
      name: "emscripten_notify_memory_growth",
    },
  ]);
});

test("rejects invalid and stale native stretcher handles", () => {
  const bytes = fs.readFileSync(new URL("../src/time-stretcher.wasm", import.meta.url));
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module, {
    env: {
      emscripten_notify_memory_growth() {},
    },
  });
  const initialize = getExportedFunction(instance.exports, "_initialize");
  const stretcherCreate = getExportedFunction(instance.exports, "stretcher_create");
  const stretcherFlush = getExportedFunction(instance.exports, "stretcher_flush");
  const stretcherFree = getExportedFunction(instance.exports, "stretcher_free");
  const stretcherGetPcm = getExportedFunction(instance.exports, "stretcher_get_pcm");
  const stretcherRead = getExportedFunction(instance.exports, "stretcher_read");
  const stretcherWrite = getExportedFunction(instance.exports, "stretcher_write");

  initialize();

  expect(stretcherCreate(999, 1.05)).toBe(0);
  expect(stretcherCreate(24_000, 0.04)).toBe(0);
  expect(stretcherCreate(24_000, Number.NaN)).toBe(0);

  const stretcher = stretcherCreate(24_000, 1.05);
  expect(typeof stretcher).toBe("number");
  if (typeof stretcher !== "number") {
    throw new Error("Sonic time stretcher did not return a numeric handle");
  }

  expect(stretcher).toBeGreaterThan(0);
  expect(stretcherWrite(stretcher, 4_609)).toBe(-1);
  expect(stretcherWrite(stretcher, -1)).toBe(-1);
  stretcherFree(stretcher);

  for (const invalidStretcher of [0, 1, stretcher]) {
    expect(stretcherGetPcm(invalidStretcher)).toBe(0);
    expect(stretcherWrite(invalidStretcher, 1)).toBe(-1);
    expect(stretcherFlush(invalidStretcher)).toBe(-1);
    expect(stretcherRead(invalidStretcher)).toBe(-1);
    expect(() => stretcherFree(invalidStretcher)).not.toThrow();
  }
});

function getExportedFunction(
  exports: WebAssembly.Exports,
  name: string,
): (...parameters: number[]) => unknown {
  const exportedFunction = exports[name];

  if (typeof exportedFunction !== "function") {
    throw new Error(`Sonic time stretcher does not export function ${name}`);
  }

  return (...parameters) => exportedFunction(...parameters);
}
