// Writes the toolchain keys that the cached `turbo:e2e:android` and `turbo:e2e:ios` tasks hash:
// `android.json` and `ios.json` in the directory `--output-dir` names. A version that cannot be read
// is written as the reason plus a random value, so that platform's task misses the cache and its
// preflight reports the problem; see ADR 0026.
import path from "node:path";
import util from "node:util";

import { writeKeyFile } from "@cup/toolchain-key/key-file";

import { readAndroidToolchainKey } from "#src/android/toolchain-key.ts";
import { readIosToolchainKey } from "#src/ios/toolchain-key.ts";

const { values } = util.parseArgs({ options: { "output-dir": { type: "string" } } });
const outputDirectory = values["output-dir"];
if (outputDirectory === undefined) {
  throw new Error("Pass the directory to write the keys to as `--output-dir <directory>`.");
}

const [androidKey, iosKey] = await Promise.all([readAndroidToolchainKey(), readIosToolchainKey()]);
await writeKeyFile(path.join(outputDirectory, "android.json"), androidKey);
await writeKeyFile(path.join(outputDirectory, "ios.json"), iosKey);
