/* oxlint-disable node/no-process-env -- The fixture reads the debugging flags. */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, inject, type TestContext } from "vitest";

import { startAuthProvider, startTestWorker, type TestWorker } from "@cup/test-worker";

import { openAndroidAppDevice, type AndroidTarget } from "#src/android/android-app-device.ts";
import type { AppDevice, MobilePlatform } from "#src/app-device.ts";
import { failureArtifactFolder, writeFailureArtifacts } from "#src/failure-artifacts.ts";
import { openIosAppDevice, type IosTarget } from "#src/ios/ios-app-device.ts";

/** Keeps a failed test's Worker persistence directory, as in the web suite. */
const RETAIN_WORKER_STATE = process.env["E2E_RETAIN_STATE"] === "1";
/** Writes each test Worker's Wrangler output to stderr while it runs, as in the web suite. */
const STREAM_WORKER_LOGS = process.env["E2E_STREAM_WRANGLER"] === "1";

type Started = {
  authProvider?: Awaited<ReturnType<typeof startAuthProvider>>;
  worker?: TestWorker;
  exposedPorts: number[];
};

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
  /** This test's fake auth provider, whose origin is in the issuer of the tokens it signs. */
  readonly authProviderOrigin: string;
};

/**
 * Opens a session on the platform's device for the spec file, and gives each test its own test
 * Worker and fake auth provider, reachable from the app at `localhost`. When a test fails, it keeps
 * the test's failure artifacts before the teardown stops the app.
 */
export function useMobileApp(): MobileApp {
  let device: AppDevice | undefined;
  /** What this test started so far, so the teardown also undoes a half-finished `beforeEach`. */
  let started: Started = { exposedPorts: [] };

  beforeAll(async () => {
    device = await openDevice(inject("mobilePlatform"));
  });

  afterAll(async () => {
    await device?.close();
  });

  beforeEach(async () => {
    const openedDevice = requireDefined(device, "The device session");
    started = { exposedPorts: [] };
    // Each test starts signed out, whatever the previous test stored.
    await openedDevice.clearAppData();
    await openedDevice.markTestStart();
    // Its origin and token issuer are `http://localhost:<port>`, as the app and the Worker see it.
    const authProvider = await startExposed(openedDevice, {
      start: () => startAuthProvider({ hostname: "localhost" }),
      stop: (server) => server.close(),
    });
    started.authProvider = authProvider;
    started.exposedPorts.push(portOf(authProvider.origin));
    const worker = await startExposed(openedDevice, {
      start: () =>
        startTestWorker({
          authProviderOrigin: authProvider.origin,
          streamLogs: STREAM_WORKER_LOGS,
        }),
      stop: (server) => server.stop(),
    });
    started.worker = worker;
    started.exposedPorts.push(portOf(worker.origin));
  });

  afterEach(async (context) => {
    const { worker, authProvider, exposedPorts } = started;
    started = { exposedPorts: [] };
    const failed = context.task.result?.state === "fail";
    const artifactFolder = failed
      ? failureArtifactFolder({
          platform: inject("mobilePlatform"),
          specFile: context.task.file.name,
          testNames: namesOf(context.task),
        })
      : undefined;

    if (artifactFolder !== undefined) {
      await writeFailureArtifacts(artifactFolder, [
        {
          fileName: "worker.log",
          capture: async () => requireDefined(worker, "This test's Worker").logs.join(""),
        },
        ...(device?.failureArtifacts() ?? []),
      ]);
      process.stderr.write(`Failure artifacts of "${context.task.name}": ${artifactFolder}\n`);
    }

    const retainPersistenceDirectory = failed && RETAIN_WORKER_STATE;
    try {
      await device?.terminate();
      for (const port of exposedPorts) {
        await device?.unexposeHostPort(port);
      }
    } finally {
      // Also when the device does not answer, so no Wrangler process outlives the test.
      await worker?.stop({ retainPersistenceDirectory });
      await authProvider?.close();
    }
    if (retainPersistenceDirectory && worker !== undefined && artifactFolder !== undefined) {
      await fs.writeFile(
        path.join(artifactFolder, "worker-persistence-directory.txt"),
        `${worker.persistenceDirectory}\n`,
      );
      process.stderr.write(
        `Retained the Worker's persistence directory: ${worker.persistenceDirectory}\n`,
      );
    }
  });

  return {
    get device() {
      return requireDefined(device, "The device session");
    },
    get worker() {
      return requireDefined(started.worker, "This test's Worker");
    },
    get apiOrigin() {
      return localhostOrigin(portOf(requireDefined(started.worker, "This test's Worker").origin));
    },
    get authProviderOrigin() {
      return requireDefined(started.authProvider, "This test's fake auth provider").origin;
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

/**
 * How many ports `startExposed` tries; a taken port is rare, five in a row means something is
 * wrong.
 */
const PORT_ATTEMPTS = 5;

/**
 * Starts a server on a port the host's operating system assigns and exposes that port to the app.
 * The device can already hold the same port for a socket of its own, which blocks exposing it; the
 * server then starts again on another assigned port. This picks a port; it repeats no test step.
 */
async function startExposed<T extends { origin: string }>(
  device: AppDevice,
  server: { start(): Promise<T>; stop(started: T): Promise<void> },
): Promise<T> {
  const takenPorts: number[] = [];
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const started = await server.start();
    const port = portOf(started.origin);
    let exposed = false;
    try {
      exposed = await device.exposeHostPort(port);
    } finally {
      if (!exposed) {
        await server.stop(started);
      }
    }
    if (exposed) {
      return started;
    }
    takenPorts.push(port);
  }
  throw new Error(
    `The device already used every port the host assigned for this test: ${takenPorts.join(", ")}.`,
  );
}

/** The app always gets `localhost`, which both platforms map to the host's loopback. */
function localhostOrigin(port: number): string {
  return `http://localhost:${port}`;
}

function portOf(origin: string): number {
  return Number(new URL(origin).port);
}

/** The test's name, preceded by the names of its `describe` blocks. */
function namesOf(task: TestContext["task"]): string[] {
  const names = [task.name];
  for (let suite = task.suite; suite?.suite !== undefined; suite = suite.suite) {
    names.unshift(suite.name);
  }
  return names;
}

function requireDefined<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`${description} has not started.`);
  }
  return value;
}
