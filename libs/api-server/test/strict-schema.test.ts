import { expect, test } from "vitest";
import { z } from "zod";

import { toStrictSchema } from "#test/strict-schema.ts";

const schema = z.object({
  items: z.array(
    z.discriminatedUnion("status", [
      z.object({ status: z.literal("ready"), title: z.string().min(1) }),
      z.object({ status: z.literal("failed") }),
    ]),
  ),
  position: z.object({ offset: z.number() }).nullable(),
  cover: z.object({ url: z.string() }).optional(),
});
const strict = toStrictSchema(schema);
const valid = { items: [{ status: "ready", title: "A" }], position: null };

test("rejects unknown keys at every nesting level", () => {
  expect(strict.parse(valid)).toEqual(valid);
  for (const value of [
    { ...valid, extra: 1 },
    { ...valid, items: [{ status: "ready", title: "A", extra: 1 }] },
    { ...valid, position: { offset: 1, extra: 1 } },
    { ...valid, cover: { url: "u", extra: 1 } },
  ]) {
    expect(strict.safeParse(value).error?.issues[0]?.code).toBe("unrecognized_keys");
    expect(schema.safeParse(value).success).toBe(true);
  }
});

test("keeps the tolerant schema's other checks", () => {
  expect(strict.safeParse({ ...valid, items: [{ status: "ready", title: "" }] }).success).toBe(
    false,
  );
});

test("refuses schema kinds it cannot make strict", () => {
  expect(() => toStrictSchema(z.record(z.string(), z.object({})))).toThrow(
    'Cannot make a "record" schema strict',
  );
});
