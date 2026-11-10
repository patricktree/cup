import { expect, test } from "vitest";

import { findOrphanedSimulators, simulatorName } from "#src/ios/simulator.ts";

const RUN = { pid: 4242, startedAt: "20261110123105" };

test("a simulator of a run that is still going is kept", () => {
  const simulators = [{ udid: "LIVE", name: simulatorName(RUN) }];

  const orphaned = findOrphanedSimulators(simulators, (pid) =>
    pid === RUN.pid ? RUN.startedAt : undefined,
  );

  expect(orphaned).toStrictEqual([]);
});

test("a simulator whose run has exited is orphaned", () => {
  const simulators = [{ udid: "DEAD", name: simulatorName(RUN) }];

  const orphaned = findOrphanedSimulators(simulators, () => undefined);

  expect(orphaned).toStrictEqual(["DEAD"]);
});

test("a simulator whose run's process ID now belongs to a later process is orphaned", () => {
  const simulators = [{ udid: "REUSED", name: simulatorName(RUN) }];

  const orphaned = findOrphanedSimulators(simulators, () => "20261110123106");

  expect(orphaned).toStrictEqual(["REUSED"]);
});

test("a simulator named before runs recorded their owner is kept, since its run may still go", () => {
  const simulators = [{ udid: "LEGACY", name: "cup-mobile-e2e-b7548c0e" }];

  const orphaned = findOrphanedSimulators(simulators, () => undefined);

  expect(orphaned).toStrictEqual([]);
});

test("simulators the suite didn't create are never touched", () => {
  const simulators = [{ udid: "MINE", name: "iPhone 18 Pro" }];

  const orphaned = findOrphanedSimulators(simulators, () => undefined);

  expect(orphaned).toStrictEqual([]);
});
