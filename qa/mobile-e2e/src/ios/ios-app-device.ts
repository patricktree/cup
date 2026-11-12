import type { AppDevice, LaunchArguments } from "#src/app-device.ts";
import { openAppiumSession, toAppiumAppState, type AppiumAppState } from "#src/appium.ts";
import { appiumFailureArtifacts, type FailureArtifact } from "#src/failure-artifacts.ts";
import { reservePort, run, waitFor } from "#src/host.ts";
import { startLoopbackRelay, type LoopbackRelay } from "#src/ios/loopback-relay.ts";
import { SHARED_PAGE_HEADING } from "#src/ios/shared-page.ts";

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
const SAFARI_BUNDLE_ID = "com.apple.mobilesafari";
/**
 * The defaults key the debug build's `TestApiOrigin` reads. Passed as the launch arguments
 * `-cupTestApiOrigin <origin>`, it lands in the arguments domain of Cup's defaults.
 */
const API_ORIGIN_KEY = "cupTestApiOrigin";
/** Cup, its share extension, WebKit's processes and Safari: the processes a test involves. */
const DEVICE_LOG_PREDICATE = [
  'process == "App"',
  'process == "CupShare"',
  'process BEGINSWITH "com.apple.WebKit"',
  'process == "MobileSafari"',
].join(" OR ");
/** Where Capacitor serves the bundled web app. */
const CUP_PAGE_ORIGIN = "capacitor://localhost";

/** The apps a share from Safari involves. */
export type ShareApp = "cup" | "safari";

/** What the listener taps in the `CupShare` extension's sheet. */
export type ShareChoice = "open in cup" | "cancel";

/** The predicates of Safari's system UI that a share from Safari taps through. */
const SHARE_SHEET = {
  // Safari's compact toolbar has no Share button; Share sits in its More menu.
  more: 'type == "XCUIElementTypeButton" AND (label == "More" OR name CONTAINS "More")',
  // In the More menu, the Share button's icon image is labelled "Share" too.
  share: 'type == "XCUIElementTypeButton" AND label == "Share"',
  cup: 'type == "XCUIElementTypeCell" AND label == "Cup"',
  openInCup: 'type == "XCUIElementTypeButton" AND label == "Open in Cup"',
  cancel: 'type == "XCUIElementTypeButton" AND label == "Cancel"',
} as const;

/**
 * The Continue button of the prompt `ASWebAuthenticationSession` shows before its sheet opens:
 * "“Cup” Wants to Use “localhost” to Sign In".
 */
const SIGN_IN_PROMPT_CONTINUE = 'type == "XCUIElementTypeButton" AND label == "Continue"';

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
  const driver = await openAppiumSession(target.appiumPort, capabilities);
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

  async exposeHostPort(port: number): Promise<boolean> {
    // The simulator shares the host's loopback; only `::1` needs to reach the port too.
    const relay = await startLoopbackRelay(port);
    if (relay === undefined) {
      return false;
    }
    this.relays.set(port, relay);
    return true;
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
      arguments: [`-${API_ORIGIN_KEY}`, launchArguments.apiOrigin],
    });
  }

  async relaunch(): Promise<void> {
    if (this.lastLaunchArguments === undefined) {
      throw new Error("Cup has not been launched in this spec file, so it cannot be relaunched.");
    }
    await this.launch(this.lastLaunchArguments);
  }

  async clearAppData(): Promise<void> {
    // iOS has no command that clears one app's data; a reinstall erases its container. The account
    // session is in the Keychain, which outlives a reinstall, so the run's own simulator's Keychain
    // is reset too.
    await this.driver.execute("mobile: removeApp", { bundleId: BUNDLE_ID });
    await run("xcrun", ["simctl", "keychain", this.target.udid, "reset"]);
    await this.driver.execute("mobile: installApp", { app: this.target.appPath });
  }

  async terminate(): Promise<void> {
    await this.driver.execute("mobile: terminateApp", { bundleId: BUNDLE_ID });
  }

  async background(): Promise<void> {
    await this.driver.execute("mobile: pressButton", { name: "home" });
  }

  async bringToForeground(): Promise<void> {
    await this.driver.execute("mobile: activateApp", { bundleId: BUNDLE_ID });
  }

  /**
   * Opens `url` in Cup, as the Share Extension's handoff does, so a running Cup receives it through
   * its scene's `openURLContexts`. A URL that starts Cup passes no launch arguments, so Cup reaches
   * the test Worker only after `storeApiOrigin`.
   */
  async openUrl(url: string): Promise<void> {
    await this.driver.execute("mobile: deepLink", { url, bundleId: BUNDLE_ID });
  }

  /**
   * Stores the test Worker's origin in Cup's defaults on the simulator, where a launch without
   * arguments, such as one a shared URL starts, finds it. Reinstalling Cup erases it.
   */
  async storeApiOrigin(apiOrigin: string): Promise<void> {
    await run("xcrun", [
      "simctl",
      "spawn",
      this.target.udid,
      "defaults",
      "write",
      BUNDLE_ID,
      API_ORIGIN_KEY,
      apiOrigin,
    ]);
  }

  /**
   * Opens `url` in Safari and shares it through the real Share Sheet: More, Share, Cup in the app
   * row, then `choice` in the `CupShare` extension's sheet. Fails when Safari's system UI has
   * changed. Ends right after the tap, without waiting for Cup.
   */
  async shareFromSafari(url: string, choice: ShareChoice): Promise<void> {
    await this.driver.switchContext("NATIVE_APP");
    await this.driver.execute("mobile: deepLink", { url, bundleId: SAFARI_BUNDLE_ID });
    await this.driver
      .$(
        `-ios predicate string:type == "XCUIElementTypeStaticText" AND label == "${SHARED_PAGE_HEADING}"`,
      )
      .waitForDisplayed({ timeout: 30_000, timeoutMsg: "Safari did not show the shared page." });
    await this.tap(SHARE_SHEET.more, "Safari's More button");
    await this.tap(SHARE_SHEET.share, "Share in Safari's More menu");
    await this.tap(SHARE_SHEET.cup, "Cup in the Share Sheet's app row");
    if (choice === "open in cup") {
      const openInCup = this.driver.$(`-ios predicate string:${SHARE_SHEET.openInCup}`);
      // The extension enables the button once it has read a valid URL from the share.
      await openInCup.waitForEnabled({
        timeout: 10_000,
        timeoutMsg: "Open in Cup stayed disabled.",
      });
      await openInCup.click();
    } else {
      await this.tap(SHARE_SHEET.cancel, "Cancel in the CupShare sheet");
      await this.driver.$(`-ios predicate string:${SHARE_SHEET.openInCup}`).waitForExist({
        reverse: true,
        timeout: 10_000,
        timeoutMsg: "The CupShare sheet stayed open.",
      });
    }
  }

  /** Whether `shareApp` runs, and whether in the foreground. */
  async appState(shareApp: ShareApp): Promise<AppiumAppState> {
    const state: unknown = await this.driver.execute("mobile: queryAppState", {
      bundleId: shareApp === "cup" ? BUNDLE_ID : SAFARI_BUNDLE_ID,
    });
    return toAppiumAppState(state, shareApp);
  }

  /**
   * The status bar's height in screen points, which the WebView's safe area covers. Leaves the
   * session in the native context, where element positions are in screen points too.
   */
  async statusBarHeight(): Promise<number> {
    await this.driver.switchContext("NATIVE_APP");
    const screenInfo: unknown = await this.driver.execute("mobile: deviceScreenInfo");
    if (
      typeof screenInfo !== "object" ||
      screenInfo === null ||
      !("statusBarSize" in screenInfo) ||
      typeof screenInfo.statusBarSize !== "object" ||
      screenInfo.statusBarSize === null ||
      !("height" in screenInfo.statusBarSize) ||
      typeof screenInfo.statusBarSize.height !== "number" ||
      screenInfo.statusBarSize.height <= 0
    ) {
      throw new Error(
        `Appium's mobile: deviceScreenInfo returned no status bar height: ${JSON.stringify(screenInfo)}`,
      );
    }
    return screenInfo.statusBarSize.height;
  }

  async continueGoogleSignIn(): Promise<void> {
    await this.driver.switchContext("NATIVE_APP");
    await this.tap(SIGN_IN_PROMPT_CONTINUE, "The prompt to sign in with localhost");
    // The sheet then loads the fake auth provider, which redirects to Cup's callback URL at once,
    // and the sheet closes.
    await this.driver.$(`-ios predicate string:${SIGN_IN_PROMPT_CONTINUE}`).waitForExist({
      reverse: true,
      timeout: 10_000,
      timeoutMsg: "The prompt to sign in with localhost stayed open.",
    });
    await this.webView();
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
      () => this.findCupPageContext(),
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
      findWebViewContext: () => this.findCupPageContext(),
      // The simulator's unified log over the whole minutes since the test started, as `log show`
      // takes durations in minutes at the finest. Unfiltered, the first minute of a new simulator
      // logged 450,000 lines (86 MB), and its errors alone 50,000, nearly all of system daemons
      // (2026-11-10), so it keeps the processes a test involves.
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
          "--predicate",
          DEVICE_LOG_PREDICATE,
        ]);
        return stdout;
      },
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.relays.keys()].map((port) => this.unexposeHostPort(port)));
    await this.driver.deleteSession();
  }

  /**
   * The context of the latest page Cup rendered, never a blank WebView: Appium hangs for minutes
   * when asked to attach to one.
   */
  private async findCupPageContext(): Promise<string | undefined> {
    const contexts: unknown = await this.driver.execute("mobile: getContexts");
    return Array.isArray(contexts) ? contexts.findLast(isCupPage)?.id : undefined;
  }

  private async tap(predicate: string, description: string): Promise<void> {
    const element = this.driver.$(`-ios predicate string:${predicate}`);
    await element.waitForDisplayed({ timeout: 10_000, timeoutMsg: `${description} did not show.` });
    await element.click();
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
