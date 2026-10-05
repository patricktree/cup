import type { AccountDurableObject } from "@cup/accounts";
import { accountArtifactBucket } from "@cup/accounts/artifact-writer";
import {
  createConversionArtifactPrefix,
  type AudiobookReference,
  type ConversionOwner,
  type ConversionPhase,
} from "@cup/conversion-contracts";
import type { ConversionGrantDurableObject } from "@cup/conversion-grants";

import type { AudiobookWorkflowEnvironment } from "#src/workflow-environment.ts";

export type ConversionExecution = {
  artifactPrefix: string;
  artifactBucket: R2Bucket;
  getReadyAudiobookReference(): Promise<AudiobookReference | undefined>;
  phaseStarted(phase: ConversionPhase): Promise<void>;
  recordReady(outcome: Parameters<ConversionGrantDurableObject["recordReady"]>[1]): Promise<void>;
  recordFailed(outcome: Parameters<ConversionGrantDurableObject["recordFailed"]>[1]): Promise<void>;
  reserveAudioSegment(
    sequence: number,
    characters: number,
  ): Promise<
    | Awaited<ReturnType<AccountDurableObject["reserveAudioSegment"]>>
    | Awaited<ReturnType<ConversionGrantDurableObject["reserveAudioSegment"]>>
  >;
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
      recordReady: async (outcome) =>
        account.settleConversion(
          conversionId,
          {
            status: "ready",
            title: outcome.title,
            audiobookReference: outcome.audiobookReference,
          },
          undefined,
          executionEpoch,
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
      reserveAudioSegment: (sequence, characters) =>
        account.reserveAudioSegment(conversionId, sequence, characters, executionEpoch),
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
    recordReady: async (outcome) => {
      await grant.recordReady(conversionId, outcome);
    },
    recordFailed: async (outcome) => {
      await grant.recordFailed(conversionId, outcome);
    },
    reserveAudioSegment: (sequence, characters) =>
      grant.reserveAudioSegment(conversionId, sequence, characters),
    completeAudioSegment: async (sequence, duration) => {
      await grant.completeAudioSegment(conversionId, sequence, duration);
    },
    releaseAudioSegment: (sequence) => grant.releaseAudioSegment(conversionId, sequence),
  };
}
