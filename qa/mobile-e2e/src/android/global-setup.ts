import type { TestProject } from "vitest/node";

import { buildAndroidDebugApp } from "#src/android/build.ts";
import { bootEmulator, type Emulator } from "#src/android/emulator.ts";
import { checkAndroidHost } from "#src/android/preflight.ts";
import { startAppium, type AppiumServer } from "#src/appium.ts";
import { run } from "#src/host.ts";

/**
 * Starts what the Android project's specs share: the run's own emulator, an Appium server and the
 * freshly built debug app installed on the emulator. Specs start their own test Worker.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const host = await checkAndroidHost();

  const started: { emulator?: Emulator; appium?: AppiumServer } = {};
  const teardown = async (): Promise<void> => {
    await Promise.all([started.emulator?.stop(), started.appium?.stop()]);
  };

  try {
    // Settle all three before acting, so a failure in one still stops the others in teardown.
    const [apk, emulator, appium] = await Promise.allSettled([
      buildAndroidDebugApp(host),
      bootEmulator(host).then((bootedEmulator) => (started.emulator = bootedEmulator)),
      startAppium({
        drivers: ["uiautomator2"],
        env: {
          ...process.env,
          ANDROID_HOME: host.sdkRoot,
          ...(host.javaHome === undefined ? {} : { JAVA_HOME: host.javaHome }),
        },
      }).then((startedAppium) => (started.appium = startedAppium)),
    ]);
    if (apk.status === "rejected") {
      throw apk.reason;
    }
    if (emulator.status === "rejected") {
      throw emulator.reason;
    }
    if (appium.status === "rejected") {
      throw appium.reason;
    }

    await run(host.adb, ["-s", emulator.value.serial, "install", "-r", apk.value]);
    project.provide("androidTarget", {
      serial: emulator.value.serial,
      adb: host.adb,
      appiumPort: appium.value.port,
    });
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
