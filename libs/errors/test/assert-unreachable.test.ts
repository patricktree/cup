import { expect, test } from "vitest";

import { assertUnreachable } from "#src/assert-unreachable.ts";

test("throws with the JSON of a value outside the union", () => {
  // The type system rejects every argument, so only an untyped call reaches the runtime check.
  expect(() => {
    Reflect.apply(assertUnreachable, undefined, [{ kind: "unknown" }]);
  }).toThrow('Unexpected value: {"kind":"unknown"}');
});
