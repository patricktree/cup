import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { SpeechSynthesisAi } from "@cup/audiobook-production";
import type { SegmentWorkflowParams } from "@cup/conversion-contracts";

import { runAudioSegmentWorkflow } from "#src/run-audio-segment-workflow.ts";
import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

type SynthesisWorkflowEnvironment = AudiobookWorkflowEnvironment & {
  AI: SpeechSynthesisAi;
};

/** Synthesizes one narration unit and settles its duration usage. */
export class SynthesizeAudioSegmentWorkflow extends WorkflowEntrypoint<
  SynthesisWorkflowEnvironment,
  SegmentWorkflowParams
> {
  override run(event: WorkflowEvent<SegmentWorkflowParams>, step: WorkflowStep) {
    return runAudioSegmentWorkflow({ env: this.env, event, step, ai: this.env.AI });
  }
}
