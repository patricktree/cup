import { expect, test } from "vitest";

import { findRootCause, findRootCauseMessage } from "#src/root-cause.ts";

test("follows a cause chain to its innermost error", () => {
  const rootCause = new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed");
  const error = new Error("Failed query: insert into grants values (?, ?)", {
    cause: new Error("Transaction failed", { cause: rootCause }),
  });

  expect(findRootCause(error)).toBe(rootCause);
  expect(findRootCauseMessage(error)).toBe("SQLITE_CONSTRAINT: UNIQUE constraint failed");
});

test("returns an error without a cause itself", () => {
  const error = new Error("Registry unavailable");

  expect(findRootCause(error)).toBe(error);
  expect(findRootCauseMessage(error)).toBe("Registry unavailable");
});

test("returns a cause that is not an error", () => {
  const error = new Error("Request failed", { cause: "socket hang up" });

  expect(findRootCause(error)).toBe("socket hang up");
  expect(findRootCauseMessage(error)).toBe("socket hang up");
});

test("returns a thrown value that is not an error", () => {
  expect(findRootCause(42)).toBe(42);
  expect(findRootCauseMessage(42)).toBe("42");
});

test("stops at a self-referencing cause", () => {
  const error = new Error("Loops on itself");
  error.cause = error;

  expect(findRootCause(error)).toBe(error);
  expect(findRootCauseMessage(error)).toBe("Loops on itself");
});

test("stops at the last error before a cause cycle repeats", () => {
  const outer = new Error("Outer");
  const inner = new Error("Inner", { cause: outer });
  outer.cause = inner;

  expect(findRootCause(outer)).toBe(inner);
  expect(findRootCauseMessage(outer)).toBe("Inner");
});
