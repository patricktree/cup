import type { ConversionOwner } from "@cup/conversion-contracts";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";

export type ConversionDispatch = {
  requestAudioSegment(
    sequence: number,
    retry: boolean,
  ): Promise<{ status: string; error?: { message: string } }>;
  retryPreparation(): Promise<void>;
};

/** Dispatch requires operation-specific request authorization before calling the owner. */
export function resolveConversionDispatch(
  env: ApiServerEnvironment,
  conversionId: string,
  owner: ConversionOwner,
): ConversionDispatch {
  if (owner.kind === "account") {
    const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner.accountId));
    return {
      requestAudioSegment: async (sequence, retry) => {
        const executionEpoch = (await account.inspect()).executionEpoch;
        return account.requestAudioSegment(
          { v: 3, conversionId, owner, executionEpoch, sequence },
          retry,
        );
      },
      retryPreparation: () => account.retryPreparation(conversionId),
    };
  }

  const grant = env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(owner.grantId));
  return {
    requestAudioSegment: (sequence, retry) =>
      grant.requestAudioSegment({ v: 3, conversionId, owner, executionEpoch: 1, sequence }, retry),
    retryPreparation: () => grant.retryPreparation(conversionId),
  };
}
