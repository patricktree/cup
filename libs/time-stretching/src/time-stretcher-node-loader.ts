import fs from "node:fs";

const timeStretcherModule = new WebAssembly.Module(
  fs.readFileSync(new URL("./time-stretcher.wasm", import.meta.url)),
);

export default timeStretcherModule;
