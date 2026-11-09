/** The platforms the suite runs on; each is a Vitest project of the same name. */
export type MobilePlatform = "android";

export type LaunchArguments = {
  /** The test Worker's origin, always `http://localhost:<port>`. */
  readonly apiOrigin: string;
};

/**
 * Drives the installed debug build of one shell on the run's device. Specs use only this interface,
 * so one spec runs on every platform; platform-only steps live on the platform's class.
 */
export type AppDevice = {
  readonly platform: MobilePlatform;
  /** Makes a port on the host reachable at `localhost:<port>` from the app. */
  exposeHostPort(port: number): Promise<void>;
  /** Undoes `exposeHostPort`. */
  unexposeHostPort(port: number): Promise<void>;
  /** Stops the app if it runs, then launches it with the given arguments. */
  launch(launchArguments: LaunchArguments): Promise<void>;
  /** Stops the app and launches it again with the arguments of the last launch. */
  relaunch(): Promise<void>;
  /** Stops the app's process. */
  terminate(): Promise<void>;
  /** Sends the app to the background, as the home button does. */
  background(): Promise<void>;
  /**
   * Waits until the app shows its WebView and returns the session switched into it, so the spec
   * reads what the listener sees in the WebView's DOM.
   */
  webView(): Promise<WebdriverIO.Browser>;
  /** Ends the Appium session; the app and the device keep running for the next spec file. */
  close(): Promise<void>;
};
