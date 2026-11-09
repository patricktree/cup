import { remote } from "webdriverio";

import type { AppDevice, LaunchArguments } from "#src/app-device.ts";
import { reservePort, run, waitFor } from "#src/host.ts";

/** What the Android global setup hands each spec file: the run's device and Appium server. */
export type AndroidTarget = {
  readonly serial: string;
  readonly adb: string;
  readonly appiumPort: number;
};

const APP_PACKAGE = "audio.cup.app";
const MAIN_ACTIVITY = `${APP_PACKAGE}/.MainActivity`;
/** Read only by the debug build's `TestApiOrigin`. */
const API_ORIGIN_EXTRA = "cupTestApiOrigin";
/** Read only by the debug build's `DebugApplication`. */
const REAL_GOOGLE_SIGN_IN_EXTRA = "cupTestRealGoogleSignIn";
const WEBVIEW_CONTEXT = `WEBVIEW_${APP_PACKAGE}`;

export type AndroidLaunchArguments = LaunchArguments & {
  /**
   * Keeps the real Google sign-in plugin, which opens Google's own screens, instead of the debug
   * build's fake that signs in against the fake auth provider.
   */
  readonly realGoogleSignIn?: boolean;
};

/** Opens an Appium session on the run's emulator, addressed by serial, without launching Cup. */
export async function openAndroidAppDevice(target: AndroidTarget): Promise<AndroidAppDevice> {
  // UiAutomator2 forwards these host ports to the device; reserve them like every other port.
  const [systemPort, chromedriverPort] = [await reservePort(), await reservePort()];
  // WebdriverIO's capability types lack some UiAutomator2 options, so the object is not a literal.
  const capabilities = {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:udid": target.serial,
    "appium:appPackage": APP_PACKAGE,
    "appium:appActivity": ".MainActivity",
    "appium:autoLaunch": false,
    "appium:noReset": true,
    "appium:systemPort": systemPort,
    "appium:chromedriverPort": chromedriverPort,
    "appium:chromedriverAutodownload": true,
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
  return new AndroidAppDevice(target, driver);
}

export class AndroidAppDevice implements AppDevice {
  readonly platform = "android";
  private readonly target: AndroidTarget;
  private readonly driver: WebdriverIO.Browser;
  private lastLaunchArguments: AndroidLaunchArguments | undefined;

  constructor(target: AndroidTarget, driver: WebdriverIO.Browser) {
    this.target = target;
    this.driver = driver;
  }

  async exposeHostPort(port: number): Promise<void> {
    await this.adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
  }

  async unexposeHostPort(port: number): Promise<void> {
    await this.adb(["reverse", "--remove", `tcp:${port}`]);
  }

  async launch(launchArguments: AndroidLaunchArguments): Promise<void> {
    this.lastLaunchArguments = launchArguments;
    // `-S` force-stops a running Cup first, so every launch is a cold start.
    await this.adb([
      "shell",
      "am",
      "start",
      "-W",
      "-S",
      "-n",
      MAIN_ACTIVITY,
      "--es",
      API_ORIGIN_EXTRA,
      launchArguments.apiOrigin,
      ...(launchArguments.realGoogleSignIn === true
        ? ["--ez", REAL_GOOGLE_SIGN_IN_EXTRA, "true"]
        : []),
    ]);
  }

  async relaunch(): Promise<void> {
    if (this.lastLaunchArguments === undefined) {
      throw new Error("Cup has not been launched in this spec file, so it cannot be relaunched.");
    }
    await this.launch(this.lastLaunchArguments);
  }

  async clearAppData(): Promise<void> {
    await this.adb(["shell", "pm", "clear", APP_PACKAGE]);
  }

  async terminate(): Promise<void> {
    await this.adb(["shell", "am", "force-stop", APP_PACKAGE]);
  }

  async background(): Promise<void> {
    await this.adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  }

  /** The package of the app in the foreground, such as Google Play services over Cup. */
  async focusedPackage(): Promise<string> {
    await this.driver.switchContext("NATIVE_APP");
    return this.driver.getCurrentPackage();
  }

  /** Presses the system back button. */
  async pressBack(): Promise<void> {
    await this.adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  }

  async webView(): Promise<WebdriverIO.Browser> {
    // A relaunch replaces the WebView's process, so attach to it anew.
    await this.driver.switchContext("NATIVE_APP");
    await waitFor(
      "Cup's WebView",
      async () => {
        const contexts = await this.driver.getContexts();
        const ids = contexts.map((context) => (typeof context === "string" ? context : context.id));
        return ids.includes(WEBVIEW_CONTEXT) ? true : undefined;
      },
      60_000,
    );
    await this.driver.switchContext(WEBVIEW_CONTEXT);
    return this.driver;
  }

  async close(): Promise<void> {
    await this.driver.deleteSession();
  }

  private async adb(args: readonly string[]): Promise<void> {
    await run(this.target.adb, ["-s", this.target.serial, ...args]);
  }
}

/** For platform-only specs in `test/android/`, which run on the Android project only. */
export function asAndroidAppDevice(device: AppDevice): AndroidAppDevice {
  if (!(device instanceof AndroidAppDevice)) {
    throw new Error(`Expected the Android device, got ${device.platform}.`);
  }
  return device;
}
