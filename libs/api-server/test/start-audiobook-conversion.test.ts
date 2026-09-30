import { expect, test } from "vitest";

import type { StartGrantConversionResult } from "@cup/conversion-grants";

import {
  startAudiobookConversion,
  type StartAudiobookConversionDependencies,
} from "#src/use-cases/start-audiobook-conversion.ts";

const CREATED_RESULT = {
  result: "created",
  conversion: {
    conversionId: "conversion-id",
    idempotencyKey: "idempotency-key",
    sourceUrl: "https://example.com/source",
    acceptedAtMs: 1_000,
    status: "pending",
    lastStartedPhase: "conversion-start",
  },
  duration: { availableMilliseconds: 4, reservedMilliseconds: 1, spentMilliseconds: 0 },
  registrySnapshot: {
    grantId: "grant-id",
    revision: 1,
    reservedMilliseconds: 1,
    spentMilliseconds: 0,
    schemaVersion: 2,
    allowanceMilliseconds: 5,
  },
} as const satisfies StartGrantConversionResult;

test("records a new conversion before starting its workflow", async () => {
  const calls: string[] = [];
  const dependencies = createDependencies(calls, async () => {
    calls.push("create-workflow");
  });

  await expect(
    startAudiobookConversion(
      {
        sourceUrl: "https://example.com/source",
        grantId: "grant-id",
        idempotencyKey: "idempotency-key",
      },
      dependencies,
    ),
  ).resolves.toBe(CREATED_RESULT);
  expect(calls).toEqual([
    "start-conversion",
    "bind-conversion",
    "apply-registry-snapshot",
    "create-workflow",
    "mark-workflow-started",
  ]);
});

test("leaves a committed conversion available for reconciliation when workflow creation fails", async () => {
  const calls: string[] = [];
  const dependencies = createDependencies(calls, async () => {
    calls.push("create-workflow");
    throw new Error("Workflow service unavailable");
  });

  await expect(
    startAudiobookConversion(
      {
        sourceUrl: "https://example.com/source",
        grantId: "grant-id",
        idempotencyKey: "idempotency-key",
      },
      dependencies,
    ),
  ).resolves.toBe(CREATED_RESULT);
  expect(calls).toEqual([
    "start-conversion",
    "bind-conversion",
    "apply-registry-snapshot",
    "create-workflow",
  ]);
});

function createDependencies(
  calls: string[],
  createWorkflow: StartAudiobookConversionDependencies["createWorkflow"],
): StartAudiobookConversionDependencies {
  return {
    grant: {
      startConversion: async () => {
        calls.push("start-conversion");
        return CREATED_RESULT;
      },
      markWorkflowStarted: async () => {
        calls.push("mark-workflow-started");
      },
    },
    registry: {
      bindConversion: async () => {
        calls.push("bind-conversion");
      },
      applyGrantRegistrySnapshot: async () => {
        calls.push("apply-registry-snapshot");
        return "applied";
      },
    },
    createWorkflow,
  };
}
