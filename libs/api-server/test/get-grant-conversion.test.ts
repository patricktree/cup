import { expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    readonly mocked = true;
  },
}));

import { ConversionPhase } from "@cup/conversion-contracts";
import { type GrantConversion } from "@cup/conversion-grants";

import { getGrantConversion } from "#src/use-cases/get-grant-conversion.ts";

const CONVERSION_ID = "2f94d6a9-68eb-49eb-b88e-753cf5fba041";
const MISSING_CONVERSION_ID = "09f35cd2-5609-4710-b49c-5c4fe08ef827";

const CONVERSION = {
  conversionId: CONVERSION_ID,
  idempotencyKey: "9336bd9d-466f-4378-9b1f-3342e61e7d90",
  sourceUrl: "https://example.com/source",
  acceptedAtMs: 0,
  status: "pending",
  lastStartedPhase: ConversionPhase.NARRATION_CONTENT_SELECTION,
} as const satisfies GrantConversion;

test("returns one public conversion snapshot", async () => {
  const requestedConversionIds: string[] = [];

  await expect(
    getGrantConversion(CONVERSION_ID, {
      getConversion: (conversionId) => {
        requestedConversionIds.push(conversionId);
        return Promise.resolve(CONVERSION);
      },
    }),
  ).resolves.toEqual({
    conversionId: CONVERSION_ID,
    sourceUrl: "https://example.com/source",
    acceptedAt: "1970-01-01T00:00:00Z",
    status: "pending",
    lastStartedPhase: ConversionPhase.NARRATION_CONTENT_SELECTION,
  });
  expect(requestedConversionIds).toEqual([CONVERSION_ID]);
});

test("returns undefined when the conversion is absent from the grant", async () => {
  await expect(
    getGrantConversion(MISSING_CONVERSION_ID, {
      getConversion: () => Promise.resolve(undefined),
    }),
  ).resolves.toBeUndefined();
});
