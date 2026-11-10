import { expect, test } from "vitest";

import { findOrphanedEmulators } from "#src/android/emulator.ts";

const AVD_ARGS = "-avd cup-mobile-e2e-api36-ram4g -no-window -no-audio -read-only";

test("an emulator whose run still runs is kept", () => {
  const processes = [
    { pid: 100, ppid: 1, command: "node vitest run" },
    { pid: 200, ppid: 100, command: `/sdk/emulator/emulator ${AVD_ARGS}` },
    { pid: 201, ppid: 200, command: `/sdk/emulator/qemu/qemu-system-aarch64-headless ${AVD_ARGS}` },
  ];

  expect(findOrphanedEmulators(processes)).toStrictEqual([]);
});

test("an emulator whose run has exited is orphaned, together with its own child processes", () => {
  const processes = [
    { pid: 200, ppid: 1, command: `/sdk/emulator/emulator ${AVD_ARGS}` },
    { pid: 201, ppid: 200, command: `/sdk/emulator/qemu/qemu-system-aarch64-headless ${AVD_ARGS}` },
  ];

  expect(findOrphanedEmulators(processes)).toStrictEqual([200, 201]);
});

test("an emulator of another AVD is never touched", () => {
  const processes = [{ pid: 300, ppid: 1, command: "/sdk/emulator/emulator -avd Pixel_9_API_36" }];

  expect(findOrphanedEmulators(processes)).toStrictEqual([]);
});
