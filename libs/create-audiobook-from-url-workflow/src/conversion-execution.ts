import { accountArtifactBucket } from "@cup/accounts/artifact-writer";
import {
  createConversionArtifactPrefix,
  type AudiobookReference,
  type ConversionOwner,
  type ConversionPhase,
} from "@cup/conversion-contracts";
import type { SegmentUsage } from "@cup/conversion-contracts/duration-accounting";
import type { ConversionGrantDurableObject } from "@cup/conversion-grants";

import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

export type ConversionExecution = {
  artifactPrefix: string;
  artifactBucket: R2Bucket;
  getReadyAudiobookReference(): Promise<AudiobookReference | undefined>;
  phaseStarted(phase: ConversionPhase): Promise<void>;
  /** Records the prepared document and reserves all of its segments, or none, in one step. */
  recordReady(
    outcome: Parameters<ConversionGrantDurableObject["recordReady"]>[1],
    narrationTextCharactersBySegment: readonly number[],
  ): Promise<void>;
  recordFailed(outcome: Parameters<ConversionGrantDurableObject["recordFailed"]>[1]): Promise<void>;
  /** Dispatches every reserved segment; reserves first when a retry finds segments unreserved. */
  startSynthesis(narrationTextCharactersBySegment: readonly number[]): Promise<void>;
  /** Reservations are taken for the whole document by the owner; a segment only checks its own. */
  getAudioSegmentState(sequence: number): Promise<SegmentUsage["state"] | undefined>;
  completeAudioSegment(sequence: number, durationMilliseconds: number): Promise<void>;
  releaseAudioSegment(sequence: number): Promise<void>;
};

/** Captures ownership and epoch; execution checks remain in the owner RPCs and artifact writer. */
export function resolveConversionExecution(
  env: AudiobookWorkflowEnvironment,
  {
    conversionId,
    owner,
    executionEpoch,
  }: {
    conversionId: string;
    owner: ConversionOwner;
    executionEpoch: number;
  },
): ConversionExecution {
  const artifactPrefix = createConversionArtifactPrefix(conversionId, owner);

  if (owner.kind === "account") {
    const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner.accountId));
    return {
      artifactPrefix,
      artifactBucket: accountArtifactBucket(
        env.AUDIO_BUCKET,
        account,
        executionEpoch,
        artifactPrefix,
      ),
      getReadyAudiobookReference: async () => {
        const outcome = (await account.getConversion(conversionId))?.outcome;
        return outcome?.status === "ready" ? outcome.audiobookReference : undefined;
      },
      phaseStarted: async () => account.assertExecution(conversionId, executionEpoch),
      recordReady: async (outcome, narrationTextCharactersBySegment) =>
        account.settleConversion(
          conversionId,
          {
            status: "ready",
            title: outcome.title,
            audiobookReference: outcome.audiobookReference,
          },
          undefined,
          executionEpoch,
          narrationTextCharactersBySegment,
        ),
      recordFailed: async (outcome) =>
        account.settleConversion(
          conversionId,
          {
            status: "failed",
            failureCategory: outcome.failureCategory,
            explanation: outcome.explanation,
          },
          undefined,
          executionEpoch,
        ),
      startSynthesis: async (narrationTextCharactersBySegment) => {
        await account.startSynthesis(
          conversionId,
          narrationTextCharactersBySegment,
          executionEpoch,
        );
      },
      getAudioSegmentState: async (sequence) => {
        await account.assertExecution(conversionId, executionEpoch);
        return (await account.listAudioSegments(conversionId)).find(
          (segment) => segment.sequence === sequence,
        )?.state;
      },
      completeAudioSegment: async (sequence, duration) => {
        await account.completeAudioSegment(conversionId, sequence, duration, executionEpoch);
      },
      releaseAudioSegment: (sequence) =>
        account.releaseAudioSegment(conversionId, sequence, executionEpoch),
    };
  }

  const grant = env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(owner.grantId));
  return {
    artifactPrefix,
    artifactBucket: env.AUDIO_BUCKET,
    getReadyAudiobookReference: () => grant.getReadyAudiobookReference(conversionId),
    phaseStarted: (phase) => grant.recordPhaseStarted(conversionId, phase),
    recordReady: async (outcome, narrationTextCharactersBySegment) => {
      await grant.recordReady(conversionId, outcome, narrationTextCharactersBySegment);
    },
    recordFailed: async (outcome) => {
      await grant.recordFailed(conversionId, outcome);
    },
    startSynthesis: async (narrationTextCharactersBySegment) => {
      await grant.startSynthesis(conversionId, narrationTextCharactersBySegment);
    },
    getAudioSegmentState: async (sequence) =>
      (await grant.listAudioSegments(conversionId)).find((segment) => segment.sequence === sequence)
        ?.state,
    completeAudioSegment: async (sequence, duration) => {
      await grant.completeAudioSegment(conversionId, sequence, duration);
    },
    releaseAudioSegment: (sequence) => grant.releaseAudioSegment(conversionId, sequence),
  };
}
