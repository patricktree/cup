import path from "node:path";

import type { AndroidHost } from "#src/android/preflight.ts";
import { run } from "#src/host.ts";

const MOBILE_APP_ROOT = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "mobile-app",
);
const ANDROID_PROJECT = path.join(MOBILE_APP_ROOT, "android");

/**
 * Copies the built production web bundle into the Android project and builds the debug APK, so a
 * run never tests a stale build. The root `test:e2e:mobile` script builds the web bundle first.
 */
export async function buildAndroidDebugApp(host: AndroidHost): Promise<string> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ANDROID_HOME: host.sdkRoot,
    ...(host.javaHome === undefined ? {} : { JAVA_HOME: host.javaHome }),
  };
  await run("pnpm", ["exec", "cap", "sync", "android"], { cwd: MOBILE_APP_ROOT, env: environment });
  await run("./gradlew", ["assembleDebug", "--console=plain", "--quiet"], {
    cwd: ANDROID_PROJECT,
    env: environment,
  });
  return path.join(ANDROID_PROJECT, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
}
