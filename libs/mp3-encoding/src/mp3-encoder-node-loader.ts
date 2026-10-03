import fs from "node:fs";

const mp3EncoderModule = new WebAssembly.Module(
  fs.readFileSync(new URL("./mp3-encoder.wasm", import.meta.url)),
);

export default mp3EncoderModule;
