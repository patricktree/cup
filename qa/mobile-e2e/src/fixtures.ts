import { afterAll, afterEach, beforeAll, beforeEach, inject } from "vitest";

import { startAuthProvider, startTestWorker, type TestWorker } from "@cup/test-worker";

import { openAndroidAppDevice, type AndroidTarget } from "#src/android/android-app-device.ts";
import type { AppDevice, MobilePlatform } from "#src/app-device.ts";
import { openIosAppDevice, type IosTarget } from "#src/ios/ios-app-device.ts";

declare module "vitest" {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Vitest types `provide` and `inject` through interface merging.
  interface ProvidedContext {
    /** Set per Vitest project in `vitest.config.ts`. */
    mobilePlatform: MobilePlatform;
    /** Provided by the Android project's global setup. */
    androidTarget: AndroidTarget;
    /** Provided by the iOS project's global setup. */
    iosTarget: IosTarget;
  }
}

export type MobileApp = {
  /** The run's device, shared by the spec file's tests. */
  readonly device: AppDevice;
  /** This test's own Worker. */
  readonly worker: TestWorker;
  /** The origin the app reaches the Worker at, passed as its launch argument. */
  readonly apiOrigin: string;
};

/**
 * Opens a session on the platform's device for the spec file, and gives each test its own test
 * Worker and fake auth provider, reachable from the app at `localhost`.
 */
export function useMobileApp(): MobileApp {
  let device: AppDevice | undefined;
  let current: { worker: TestWorker; apiOrigin: string; cleanUp: () => Promise<void> } | undefined;

  beforeAll(async () => {
    device = await openDevice(inject("mobilePlatform"));
  });

  afterAll(async () => {
    await device?.close();
  });

  beforeEach(async () => {
    const openedDevice = requireDefined(device, "The device session");
    // Each test starts signed out, whatever the previous test stored.
    await openedDevice.clearAppData();
    // Its origin and token issuer are `http://localhost:<port>`, as the app and the Worker see it.
    const authProvider = await startAuthProvider({ hostname: "localhost" });
    const authProviderPort = portOf(authProvider.origin);
    const worker = await startTestWorker({ authProviderOrigin: authProvider.origin });
    const workerPort = portOf(worker.origin);
    await openedDevice.exposeHostPort(workerPort);
    await openedDevice.exposeHostPort(authProviderPort);

    current = {
      worker,
      apiOrigin: localhostOrigin(workerPort),
      cleanUp: async () => {
        await openedDevice.terminate();
        await openedDevice.unexposeHostPort(workerPort);
        await openedDevice.unexposeHostPort(authProviderPort);
        await worker.stop();
        await authProvider.close();
      },
    };
  });

  afterEach(async () => {
    await current?.cleanUp();
    current = undefined;
  });

  return {
    get device() {
      return requireDefined(device, "The device session");
    },
    get worker() {
      return requireDefined(current, "This test's Worker").worker;
    },
    get apiOrigin() {
      return requireDefined(current, "This test's Worker").apiOrigin;
    },
  };
}

async function openDevice(platform: MobilePlatform): Promise<AppDevice> {
  if (platform === "android") {
    return openAndroidAppDevice(inject("androidTarget"));
  }
  if (platform === "ios") {
    return openIosAppDevice(inject("iosTarget"));
  }
  throw new Error(`Unknown mobile platform: ${String(platform)}`);
}

/** The app always gets `localhost`, which both platforms map to the host's loopback. */
function localhostOrigin(port: number): string {
  return `http://localhost:${port}`;
}

function portOf(origin: string): number {
  return Number(new URL(origin).port);
}

function requireDefined<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`${description} has not started.`);
  }
  return value;
}
