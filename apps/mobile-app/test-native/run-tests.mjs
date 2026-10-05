import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cup-native-tests-"));
const executable = path.join(directory, "playback-tests");
const app = path.resolve(import.meta.dirname, "../ios/App/App");

try {
  childProcess.execFileSync(
    "xcrun",
    [
      "swiftc",
      path.join(app, "NarrationPlaybackDependencies.swift"),
      path.join(app, "NarrationPlaybackCoordinator.swift"),
      path.join(app, "NarrationPositionStore.swift"),
      path.join(import.meta.dirname, "PlaybackCoordinatorTests.swift"),
      "-o",
      executable,
    ],
    { stdio: "inherit" },
  );
  childProcess.execFileSync(executable, [], { stdio: "inherit" });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
