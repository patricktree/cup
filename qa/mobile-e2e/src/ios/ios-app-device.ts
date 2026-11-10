import { remote } from "webdriverio";

import type { AppDevice, LaunchArguments } from "#src/app-device.ts";
import { appiumFailureArtifacts, type FailureArtifact } from "#src/failure-artifacts.ts";
import { reservePort, run, waitFor } from "#src/host.ts";
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
/** Where Capacitor serves the bundled web app. */
const CUP_PAGE_ORIGIN = "capacitor://localhost";

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
  /** When the test started, from `performance.now()`. */
  private testStart: number | undefined;

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

  /**
   * Opens `url` in Cup, as the Share Extension's handoff does, so a running Cup receives it through
   * its scene's `openURLContexts`. Cup must run with the launch arguments, because a URL that
   * starts Cup gets none and would reach `https://cup.audio`.
   */
  async openUrl(url: string): Promise<void> {
    await this.driver.execute("mobile: deepLink", { url, bundleId: BUNDLE_ID });
  }

  async webView(): Promise<WebdriverIO.Browser> {
    // A relaunch gives the WebView a new context, named after Cup's new process.
    await this.driver.switchContext("NATIVE_APP");
    // When WebKit's content process crashes at launch, the WebView stays at `about:blank`, and
    // Appium hangs for minutes when asked to attach to it. Wait for rendered text instead, which
    // also keeps Web Inspector away from a page still loading.
    await this.driver
      .$("-ios class chain:**/XCUIElementTypeWebView/**/XCUIElementTypeStaticText[1]")
      .waitForExist({ timeout: 60_000, timeoutMsg: "Cup's WebView rendered no page." });
    const webViewContext = await waitFor(
      "Cup's WebView context",
      async () => {
        const contexts: unknown = await this.driver.execute("mobile: getContexts");
        return Array.isArray(contexts) ? contexts.findLast(isCupPage)?.id : undefined;
      },
      30_000,
    );
    await this.driver.switchContext(webViewContext);
    return this.driver;
  }

  async markTestStart(): Promise<void> {
    this.testStart = performance.now();
  }

  failureArtifacts(): FailureArtifact[] {
    return appiumFailureArtifacts({
      driver: this.driver,
      // Only a page Cup rendered: Appium hangs for minutes when asked to attach to a blank WebView.
      findWebViewContext: async () => {
        const contexts: unknown = await this.driver.execute("mobile: getContexts");
        return Array.isArray(contexts) ? contexts.findLast(isCupPage)?.id : undefined;
      },
      // The simulator's unified log over the whole minutes since the test started, as `log show`
      // takes durations in minutes at the finest.
      readDeviceLog: async () => {
        const elapsedMs = performance.now() - (this.testStart ?? performance.now());
        const minutes = Math.max(1, Math.ceil(elapsedMs / 60_000));
        const { stdout } = await run("xcrun", [
          "simctl",
          "spawn",
          this.target.udid,
          "log",
          "show",
          "--style",
          "compact",
          "--last",
          `${minutes}m`,
        ]);
        return stdout;
      },
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.relays.keys()].map((port) => this.unexposeHostPort(port)));
    await this.driver.deleteSession();
  }
}

/** For platform-only specs in `test/ios/`, which run on the iOS project only. */
export function asIosAppDevice(device: AppDevice): IosAppDevice {
  if (!(device instanceof IosAppDevice)) {
    throw new Error(`Expected the iOS device, got ${device.platform}.`);
  }
  return device;
}

function isCupPage(context: unknown): context is { id: string } {
  return (
    typeof context === "object" &&
    context !== null &&
    "id" in context &&
    typeof context.id === "string" &&
    context.id.startsWith("WEBVIEW_") &&
    "url" in context &&
    typeof context.url === "string" &&
    context.url.startsWith(CUP_PAGE_ORIGIN)
  );
}
