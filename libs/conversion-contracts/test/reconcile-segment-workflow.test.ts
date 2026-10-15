import { expect, test, vi } from "vitest";

import {
  reconcileSegmentWorkflow,
  type SegmentWorkflowParams,
  type SynthesisWorkflowDispatcher,
} from "#src/index.ts";

const PARAMS = {
  v: 3,
  conversionId: "2f94d6a9-68eb-49eb-b88e-753cf5fba041",
  owner: { kind: "trial", grantId: "9336bd9d-466f-4378-9b1f-3342e61e7d90" },
  executionEpoch: 1,
  sequence: 4,
} as const satisfies SegmentWorkflowParams;
const INSTANCE_ID = "segment-2f94d6a9-68eb-49eb-b88e-753cf5fba041-4";

function createWorkflow(status: string | undefined) {
  const restart = vi.fn<() => Promise<void>>().mockResolvedValue();
  const create = vi.fn<SynthesisWorkflowDispatcher["create"]>().mockResolvedValue(undefined);
  const workflow: SynthesisWorkflowDispatcher = {
    create,
    get: async () => {
      if (status === undefined) {
        throw new Error("instance.not_found");
      }
      return { status: async () => ({ status }), restart };
    },
  };
  return { workflow, create, restart };
}

test("a reserved segment without an instance is dispatched", async () => {
  const { workflow, create } = createWorkflow(undefined);

  await expect(reconcileSegmentWorkflow(workflow, PARAMS, { canResume: true })).resolves.toBe(
    "in-progress",
  );
  expect(create).toHaveBeenCalledWith({ id: INSTANCE_ID, params: PARAMS });
});

test("an errored instance of a reserved segment is restarted, not released", async () => {
  const { workflow, restart } = createWorkflow("errored");

  await expect(reconcileSegmentWorkflow(workflow, PARAMS, { canResume: true })).resolves.toBe(
    "in-progress",
  );
  expect(restart).toHaveBeenCalledOnce();
});

test("an errored instance is reported as stopped when its owner can no longer run work", async () => {
  const { workflow, restart } = createWorkflow("errored");

  await expect(reconcileSegmentWorkflow(workflow, PARAMS, { canResume: false })).resolves.toBe(
    "stopped",
  );
  expect(restart).not.toHaveBeenCalled();
});

test("a terminated instance is reported as stopped", async () => {
  const { workflow, restart } = createWorkflow("terminated");

  await expect(reconcileSegmentWorkflow(workflow, PARAMS, { canResume: true })).resolves.toBe(
    "stopped",
  );
  expect(restart).not.toHaveBeenCalled();
});

test("a running instance is left alone", async () => {
  const { workflow, create, restart } = createWorkflow("running");

  await expect(reconcileSegmentWorkflow(workflow, PARAMS, { canResume: true })).resolves.toBe(
    "in-progress",
  );
  expect(create).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
});
