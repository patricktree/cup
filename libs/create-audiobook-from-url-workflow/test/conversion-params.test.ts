import { expect, test } from "vitest";

import { conversionParamsSchema } from "#src/conversion-params.ts";

test("accepts a valid source URL", () => {
  expect(
    conversionParamsSchema.parse({
      sourceUrl: "https://www.derstandard.at/story/example",
      grantId: "9c5cf475-6d1e-4c89-a835-1180f5c062be",
    }),
  ).toEqual({
    sourceUrl: "https://www.derstandard.at/story/example",
    grantId: "9c5cf475-6d1e-4c89-a835-1180f5c062be",
  });
});

test("rejects a missing source URL", () => {
  expect(() => conversionParamsSchema.parse({})).toThrow(/sourceUrl/);
});

test("accepts account work without a prefix and rejects a supplied prefix", () => {
  const accountId = "9c5cf475-6d1e-4c89-a835-1180f5c062be";
  const conversionId = "299a0035-4580-4672-9527-87e49bfffd80";
  const payload = {
    v: 2,
    sourceUrl: "https://example.com/",
    owner: { kind: "account", accountId },
    conversionId,
    executionEpoch: 1,
  };
  expect(conversionParamsSchema.parse(payload)).toEqual(payload);
  expect(() =>
    conversionParamsSchema.parse({ ...payload, artifactPrefix: `conversions/${conversionId}/` }),
  ).toThrow(/artifactPrefix/);
});
