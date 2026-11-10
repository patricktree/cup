import type { TestProject } from "vitest/node";

import { startAppium, type AppiumServer } from "#src/appium.ts";
import { clearFailureArtifacts } from "#src/failure-artifacts.ts";
import { run } from "#src/host.ts";
import { buildIosDebugApp } from "#src/ios/build.ts";
import { checkIosHost } from "#src/ios/preflight.ts";
import { createSimulator, type Simulator } from "#src/ios/simulator.ts";
import { ensureWebDriverAgent } from "#src/ios/web-driver-agent.ts";

/**
 * Starts what the iOS project's specs share: the run's own simulator, an Appium server with a
 * prebuilt WebDriverAgent and the freshly built debug app installed on the simulator. Specs start
 * their own test Worker.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const host = await checkIosHost();
  await clearFailureArtifacts("ios");

  const started: { simulator?: Simulator; appium?: AppiumServer } = {};
  const teardown = async (): Promise<void> => {
    await Promise.all([started.simulator?.delete(), started.appium?.stop()]);
  };

  try {
    // Settle all three before acting, so a failure in one still stops the others in teardown.
    const [app, simulator, webDriverAgent] = await Promise.allSettled([
      buildIosDebugApp(),
      createSimulator(host).then((createdSimulator) => (started.simulator = createdSimulator)),
      // Installing the XCUITest driver brings the WebDriverAgent sources to build.
      startAppium({ drivers: ["xcuitest"], env: process.env }).then(async (startedAppium) => {
        started.appium = startedAppium;
        return {
          appiumPort: startedAppium.port,
          derivedData: await ensureWebDriverAgent(host),
        };
      }),
    ]);
    if (app.status === "rejected") {
      throw app.reason;
    }
    if (simulator.status === "rejected") {
      throw simulator.reason;
    }
    if (webDriverAgent.status === "rejected") {
      throw webDriverAgent.reason;
    }

    await run("xcrun", ["simctl", "install", simulator.value.udid, app.value]);
    project.provide("iosTarget", {
      udid: simulator.value.udid,
      platformVersion: host.runtime.version,
      appiumPort: webDriverAgent.value.appiumPort,
      appPath: app.value,
      webDriverAgentDerivedData: webDriverAgent.value.derivedData,
    });
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
