import { expect, test } from "vitest";

import { parseProcessStartTimes } from "#src/run-owner.ts";

test("reads each process's start time from `ps`, to the second", () => {
  const startTimeOf = parseProcessStartTimes(
    ["    1 Thu Nov  5 11:30:45 2026    ", "73170 Tue Nov 10 09:03:07 2026    ", ""].join("\n"),
  );

  expect(startTimeOf(1)).toBe("20261105113045");
  expect(startTimeOf(73_170)).toBe("20261110090307");
  expect(startTimeOf(2)).toBeUndefined();
});

test("fails on a line it can't read rather than calling a running process gone", () => {
  expect(() => parseProcessStartTimes("73170 sometime\n")).toThrow(TypeError);
});
