import { expect, test, vi } from "vitest";

import {
  getAudioSegmentState,
  type GetAudioSegmentStateDependencies,
} from "#src/use-cases/get-audio-segment-state.ts";

const input = {
  conversionId: "conversion",
  owner: { kind: "trial", grantId: "grant" } as const,
  sequence: 2,
  origin: "https://cup.example",
};

function dependencies() {
  return {
    listAudioSegments: vi
      .fn<GetAudioSegmentStateDependencies["listAudioSegments"]>()
      .mockResolvedValue([]),
    getWorkflowStatus: vi
      .fn<GetAudioSegmentStateDependencies["getWorkflowStatus"]>()
      .mockResolvedValue({ status: "running" }),
    getFailureExplanation: vi
      .fn<GetAudioSegmentStateDependencies["getFailureExplanation"]>()
      .mockResolvedValue(undefined),
  };
}

test("settled audio is playable without consulting the workflow or failure storage", async () => {
  const services = dependencies();
  services.listAudioSegments.mockResolvedValue([
    { sequence: 1, state: "settled", actualMilliseconds: 900 },
    { sequence: 2, state: "settled", actualMilliseconds: 1200 },
  ]);
  expect(await getAudioSegmentState(input, services)).toEqual({
    sequence: 2,
    status: "ready",
    durationMilliseconds: 1200,
    url: "https://cup.example/api/files/audiobooks/conversion/segments/2/audio.mp3",
  });
  expect(services.getWorkflowStatus).not.toHaveBeenCalled();
  expect(services.getFailureExplanation).not.toHaveBeenCalled();
});

test("a missing workflow makes an unsettled segment absent", async () => {
  const services = dependencies();
  services.getWorkflowStatus.mockRejectedValue(new Error("Workflow not found"));
  expect(await getAudioSegmentState(input, services)).toEqual({ sequence: 2, status: "absent" });
});

test.each(["running", "queued", "waiting"])(
  "an unsettled %s workflow is generating",
  async (status) => {
    const services = dependencies();
    services.getWorkflowStatus.mockResolvedValue({ status });
    expect(await getAudioSegmentState(input, services)).toEqual({
      sequence: 2,
      status: "generating",
    });
  },
);

test.each(["errored", "terminated"])(
  "a %s workflow uses stored failure details before platform errors",
  async (status) => {
    const services = dependencies();
    services.getWorkflowStatus.mockResolvedValue({ status, error: { message: "Platform error" } });
    services.getFailureExplanation.mockResolvedValue("Stored explanation");
    expect(await getAudioSegmentState(input, services)).toEqual({
      sequence: 2,
      status: "failed",
      explanation: "Stored explanation",
    });
  },
);

test("failure details are read from the owning account's artifact prefix", async () => {
  const services = dependencies();
  services.getWorkflowStatus.mockResolvedValue({ status: "errored" });
  await getAudioSegmentState(
    { ...input, owner: { kind: "account", accountId: "account" } },
    services,
  );
  expect(services.getFailureExplanation).toHaveBeenCalledWith(
    "accounts/account/conversions/conversion/segment-2-failure.json",
  );
});

test("a failed workflow falls back to its platform error, then the retry explanation", async () => {
  const services = dependencies();
  services.getWorkflowStatus.mockResolvedValue({
    status: "errored",
    error: { message: "Platform error" },
  });
  expect(await getAudioSegmentState(input, services)).toEqual({
    sequence: 2,
    status: "failed",
    explanation: "Platform error",
  });
  services.getWorkflowStatus.mockResolvedValue({ status: "errored" });
  expect(await getAudioSegmentState(input, services)).toEqual({
    sequence: 2,
    status: "failed",
    explanation: "Speech generation failed. Retry this passage.",
  });
});

test("a completed workflow without settlement is an invariant violation", async () => {
  const services = dependencies();
  services.getWorkflowStatus.mockResolvedValue({ status: "complete" });
  await expect(getAudioSegmentState(input, services)).rejects.toThrow(
    "Completed segment is missing its settlement",
  );
});
