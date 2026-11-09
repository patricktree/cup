import { run } from "#src/host.ts";

/** What the iOS run needs from the host, checked before any simulator starts. */
export type IosHost = {
  /** Xcode's build version, such as `27B52`; a new Xcode needs a new WebDriverAgent build. */
  readonly xcodeBuildVersion: string;
  readonly runtime: {
    readonly identifier: string;
    /** Such as `26.3.1`. */
    readonly version: string;
  };
  /** The iPhone device type each run's simulator is created from. */
  readonly deviceTypeIdentifier: string;
};

const PREFERRED_DEVICE_TYPE = "iPhone 17";
const RESTART_CORE_SIMULATOR = "killall -9 com.apple.CoreSimulator.CoreSimulatorService";

/**
 * Checks that the host has every tool an iOS run needs, before any simulator starts, and fails with
 * the fix rather than skipping the platform.
 */
export async function checkIosHost(): Promise<IosHost> {
  const xcode = await readXcodeVersion();
  const macosVersion = (await run("sw_vers", ["-productVersion"])).stdout.trim();
  const macosMajor = majorOf(macosVersion);
  // Since version 26, Xcode and macOS share major versions, and an older Xcode's XCTest runners
  // hang on a newer macOS: WebDriverAgent never answers and the session times out after minutes.
  if (macosMajor >= 26 && majorOf(xcode.version) < macosMajor) {
    fail(
      `Xcode ${xcode.version} does not support macOS ${macosVersion}: every XCTest runner hangs on it, WebDriverAgent included. Update Xcode to ${String(macosMajor)} or later, then restart CoreSimulatorService with \`${RESTART_CORE_SIMULATOR}\`.`,
    );
  }

  const runtime = await findIosRuntime();
  const deviceType =
    runtime.supportedDeviceTypes.find((candidate) => candidate.name === PREFERRED_DEVICE_TYPE) ??
    runtime.supportedDeviceTypes.findLast((candidate) => candidate.productFamily === "iPhone");
  if (deviceType === undefined) {
    fail(`The iOS ${runtime.version} simulator runtime supports no iPhone.`);
  }
  return {
    xcodeBuildVersion: xcode.buildVersion,
    runtime: { identifier: runtime.identifier, version: runtime.version },
    deviceTypeIdentifier: deviceType.identifier,
  };
}

async function readXcodeVersion(): Promise<{ version: string; buildVersion: string }> {
  let output: string;
  try {
    output = (await run("xcodebuild", ["-version"])).stdout;
  } catch {
    fail(
      "Xcode is missing, or the active developer directory is the Command Line Tools. Install Xcode from the App Store, then select it with `sudo xcode-select --switch /Applications/Xcode.app`.",
    );
  }
  const version = /^Xcode (\S+)/m.exec(output)?.[1];
  const buildVersion = /^Build version (\S+)/m.exec(output)?.[1];
  if (version === undefined || buildVersion === undefined) {
    fail(`\`xcodebuild -version\` printed no Xcode version:\n${output}`);
  }
  return { version, buildVersion };
}

type SimulatorRuntime = {
  identifier: string;
  version: string;
  supportedDeviceTypes: { identifier: string; name: string; productFamily: string }[];
};

/** Returns the newest available iOS simulator runtime. */
async function findIosRuntime(): Promise<SimulatorRuntime> {
  let result;
  try {
    result = await run("xcrun", ["simctl", "list", "runtimes", "--json"]);
  } catch (error) {
    failWithSimulatorServiceHint(String(error));
  }
  // After an Xcode update, the running CoreSimulatorService is older than simctl, which then warns
  // about the version mismatch and lists no runtimes.
  if (/CoreSimulator/i.test(result.stderr)) {
    failWithSimulatorServiceHint(result.stderr);
  }
  const runtimes = parseIosRuntimes(result.stdout).toSorted((left, right) =>
    right.version.localeCompare(left.version, undefined, { numeric: true }),
  );
  const [newest] = runtimes;
  if (newest === undefined) {
    fail(
      `No iOS simulator runtime is installed. Install one with \`xcodebuild -downloadPlatform iOS\`, or in Xcode under Settings > Components. If one is installed, restart CoreSimulatorService with \`${RESTART_CORE_SIMULATOR}\`.`,
    );
  }
  return newest;
}

/** Returns the available iOS runtimes of `simctl list runtimes --json`. */
function parseIosRuntimes(json: string): SimulatorRuntime[] {
  const listing: unknown = JSON.parse(json);
  const runtimes =
    isRecord(listing) && Array.isArray(listing["runtimes"]) ? listing["runtimes"] : [];
  return runtimes.flatMap((runtime: unknown): SimulatorRuntime[] => {
    if (
      !isRecord(runtime) ||
      runtime["isAvailable"] !== true ||
      runtime["platform"] !== "iOS" ||
      typeof runtime["identifier"] !== "string" ||
      typeof runtime["version"] !== "string" ||
      !Array.isArray(runtime["supportedDeviceTypes"])
    ) {
      return [];
    }
    const supportedDeviceTypes = runtime["supportedDeviceTypes"].flatMap((deviceType: unknown) =>
      isRecord(deviceType) &&
      typeof deviceType["identifier"] === "string" &&
      typeof deviceType["name"] === "string" &&
      typeof deviceType["productFamily"] === "string"
        ? [
            {
              identifier: deviceType["identifier"],
              name: deviceType["name"],
              productFamily: deviceType["productFamily"],
            },
          ]
        : [],
    );
    return [
      { identifier: runtime["identifier"], version: runtime["version"], supportedDeviceTypes },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function failWithSimulatorServiceHint(output: string): never {
  fail(
    `simctl cannot reach CoreSimulatorService, which happens after an Xcode update. Restart it with \`${RESTART_CORE_SIMULATOR}\`.\n${output}`,
  );
}

function majorOf(version: string): number {
  return Number.parseInt(version, 10);
}

function fail(problem: string): never {
  throw new Error(
    `The iOS run of the mobile E2E suite cannot start:\n- ${problem}\nSee qa/mobile-e2e/README.md for the prerequisites.`,
  );
}
