import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import util from "node:util";
import { afterEach, expect, test } from "vitest";

const CLI = url.fileURLToPath(new URL("../src/toolchain-key.ts", import.meta.url));
const execFile = util.promisify(childProcess.execFile);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("writes the same Android key on every run while the toolchain stays the same", async () => {
  const directory = await makeTemporaryDirectory();
  const sdkRoot = path.join(directory, "sdk");
  await writeSourceProperties(sdkRoot, "platform-tools", "Pkg.Revision=37.0.0");
  await writeSourceProperties(sdkRoot, "platforms/android-36", "Pkg.Revision=2");
  await writeSourceProperties(sdkRoot, "emulator", "Pkg.Revision=36.4.10\nPkg.BuildId=15004761");
  await writeSourceProperties(
    sdkRoot,
    "system-images/android-36/google_apis/arm64-v8a",
    "Pkg.Revision=7",
  );
  const javaHome = await writeFakeJava(directory, "21.0.8+9-b1038.76", "JetBrains s.r.o.");
  const env = { ...process.env, ANDROID_HOME: sdkRoot, JAVA_HOME: javaHome };

  const firstKey = await runCli(path.join(directory, "first"), env);
  const secondKey = await runCli(path.join(directory, "second"), env);

  expect(secondKey.android).toBe(firstKey.android);
  expect(JSON.parse(firstKey.android)).toMatchObject({
    platformTools: "37.0.0",
    platform: { package: "platforms;android-36", revision: "2" },
    emulator: { revision: "36.4.10", buildId: "15004761" },
    systemImage: {
      package: "system-images;android-36;google_apis;arm64-v8a",
      revision: "7",
    },
    java: { runtimeVersion: "21.0.8+9-b1038.76", vendor: "JetBrains s.r.o." },
    macos: { productVersion: expect.any(String), buildVersion: expect.any(String) },
  });
});

test("writes a different key on every run when a platform's toolchain cannot be read", async () => {
  const directory = await makeTemporaryDirectory();
  const missing = path.join(directory, "missing");
  // No Android SDK, no Java and no Xcode, as on a Mac before Android Studio and Xcode are installed.
  const env = {
    ...process.env,
    ANDROID_HOME: missing,
    JAVA_HOME: missing,
    DEVELOPER_DIR: missing,
  };

  const firstKey = await runCli(path.join(directory, "first"), env);
  const secondKey = await runCli(path.join(directory, "second"), env);

  expect(secondKey.android).not.toBe(firstKey.android);
  expect(secondKey.ios).not.toBe(firstKey.ios);
  expect(JSON.parse(firstKey.android)).toMatchObject({
    emulator: { unreadable: expect.stringContaining("emulator/source.properties") },
    java: { unreadable: expect.stringContaining("java") },
  });
  expect(JSON.parse(firstKey.ios)).toMatchObject({
    xcode: { unreadable: expect.stringContaining("xcodebuild") },
    macos: { productVersion: expect.any(String), buildVersion: expect.any(String) },
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-toolchain-key-"));
  directories.push(directory);
  return directory;
}

async function runCli(
  outputDirectory: string,
  env: NodeJS.ProcessEnv,
): Promise<{ android: string; ios: string }> {
  await execFile(process.execPath, [CLI, "--output-dir", outputDirectory], { env });
  return {
    android: await fs.readFile(path.join(outputDirectory, "android.json"), "utf8"),
    ios: await fs.readFile(path.join(outputDirectory, "ios.json"), "utf8"),
  };
}

async function writeSourceProperties(
  sdkRoot: string,
  packagePath: string,
  properties: string,
): Promise<void> {
  const packageDirectory = path.join(sdkRoot, packagePath);
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.writeFile(path.join(packageDirectory, "source.properties"), `${properties}\n`);
}

/** A `bin/java` that prints the property lines `java -XshowSettings:properties -version` prints. */
async function writeFakeJava(
  directory: string,
  runtimeVersion: string,
  vendor: string,
): Promise<string> {
  const javaHome = path.join(directory, "jdk");
  const java = path.join(javaHome, "bin", "java");
  await fs.mkdir(path.dirname(java), { recursive: true });
  await fs.writeFile(
    java,
    [
      "#!/bin/sh",
      "cat >&2 <<'EOF'",
      "Property settings:",
      `    java.runtime.version = ${runtimeVersion}`,
      `    java.vendor = ${vendor}`,
      "",
      `openjdk version "${runtimeVersion}"`,
      "EOF",
      "",
    ].join("\n"),
  );
  await fs.chmod(java, 0o755);
  return javaHome;
}
