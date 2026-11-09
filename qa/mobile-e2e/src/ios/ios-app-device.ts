import { remote } from "webdriverio";

import type { AppDevice, LaunchArguments } from "#src/app-device.ts";
import { reservePort, waitFor } from "#src/host.ts";
import { startLoopbackRelay, type LoopbackRelay } from "#src/ios/loopback-relay.ts";

/** What the iOS global setup hands each spec file: the run's simulator and Appium server. */
export type IosTarget = {
  readonly udid: string;
  readonly platformVersion: string;
  readonly appiumPort: number;
  /** The debug app the global setup built, reinstalled to clear its data. */
  readonly appPath: string;
  /** The derived data folder of the prebuilt WebDriverAgent. */
  readonly webDriverAgentDerivedData: string;
};

const BUNDLE_ID = "audio.cup.app";
/** Read only by the debug build's `TestApiOrigin`. */
const API_ORIGIN_ARGUMENT = "-cupTestApiOrigin";

/** Opens an Appium session on the run's simulator, addressed by UDID, without launching Cup. */
export async function openIosAppDevice(target: IosTarget): Promise<IosAppDevice> {
  // WebDriverAgent listens on these ports of the host's loopback; reserve them like every other port.
  const [wdaLocalPort, mjpegServerPort] = [await reservePort(), await reservePort()];
  const capabilities = {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": target.udid,
    "appium:platformVersion": target.platformVersion,
    "appium:bundleId": BUNDLE_ID,
    "appium:autoLaunch": false,
    "appium:noReset": true,
    "appium:wdaLocalPort": wdaLocalPort,
    "appium:mjpegServerPort": mjpegServerPort,
    // Runs the prebuilt WebDriverAgent with `test-without-building`, never building it here.
    "appium:usePrebuiltWDA": true,
    "appium:derivedDataPath": target.webDriverAgentDerivedData,
    "appium:wdaLaunchTimeout": 120_000,
    "appium:webviewConnectTimeout": 20_000,
    "appium:newCommandTimeout": 600,
  };
  const driver = await remote({
    hostname: "127.0.0.1",
    port: target.appiumPort,
    logLevel: "warn",
    connectionRetryCount: 0,
    connectionRetryTimeout: 180_000,
    capabilities,
  });
  return new IosAppDevice(target, driver);
}

export class IosAppDevice implements AppDevice {
  readonly platform = "ios";
  private readonly target: IosTarget;
  private readonly driver: WebdriverIO.Browser;
  private readonly relays = new Map<number, LoopbackRelay>();
  private lastLaunchArguments: LaunchArguments | undefined;

  constructor(target: IosTarget, driver: WebdriverIO.Browser) {
    this.target = target;
    this.driver = driver;
  }

  async exposeHostPort(port: number): Promise<void> {
    // The simulator shares the host's loopback; only `::1` needs to reach the port too.
    this.relays.set(port, await startLoopbackRelay(port));
  }

  async unexposeHostPort(port: number): Promise<void> {
    await this.relays.get(port)?.close();
    this.relays.delete(port);
  }

  async launch(launchArguments: LaunchArguments): Promise<void> {
    this.lastLaunchArguments = launchArguments;
    // Every launch is a cold start.
    await this.terminate();
    await this.driver.execute("mobile: launchApp", {
      bundleId: BUNDLE_ID,
      arguments: [API_ORIGIN_ARGUMENT, launchArguments.apiOrigin],
    });
  }

  async relaunch(): Promise<void> {
    if (this.lastLaunchArguments === undefined) {
      throw new Error("Cup has not been launched in this spec file, so it cannot be relaunched.");
    }
    await this.launch(this.lastLaunchArguments);
  }

  async clearAppData(): Promise<void> {
    // iOS has no command that clears one app's data; a reinstall erases its container, including
    // the WebView's localStorage that holds the account session.
    await this.driver.execute("mobile: removeApp", { bundleId: BUNDLE_ID });
    await this.driver.execute("mobile: installApp", { app: this.target.appPath });
  }

  async terminate(): Promise<void> {
    await this.driver.execute("mobile: terminateApp", { bundleId: BUNDLE_ID });
  }

  async background(): Promise<void> {
    await this.driver.execute("mobile: pressButton", { name: "home" });
  }

  async webView(): Promise<WebdriverIO.Browser> {
    // A relaunch gives the WebView a new context, named after Cup's new process.
    await this.driver.switchContext("NATIVE_APP");
    const webViewContext = await waitFor(
      "Cup's WebView",
      async () => {
        const contexts = await this.driver.getContexts();
        const ids = contexts.map((context) => (typeof context === "string" ? context : context.id));
        return ids.findLast((id) => id.startsWith("WEBVIEW_"));
      },
      60_000,
    );
    await this.driver.switchContext(webViewContext);
    return this.driver;
  }

  async close(): Promise<void> {
    await Promise.all([...this.relays.keys()].map((port) => this.unexposeHostPort(port)));
    await this.driver.deleteSession();
  }
}
