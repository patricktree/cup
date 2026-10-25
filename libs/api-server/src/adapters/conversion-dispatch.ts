import type { ConversionOwner } from "@cup/conversion-contracts";
import type { InsufficientDuration } from "@cup/conversion-contracts/duration-accounting";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";

export type ConversionDispatch = {
  /** Reserves and dispatches every segment lacking audio, or reserves nothing. */
  startSynthesis(
    narrationTextCharactersBySegment: readonly number[],
  ): Promise<
    | { result: "started" }
    | ({ result: "insufficient-duration" } & InsufficientDuration)
    | { result: "expired" | "revoked" }
  >;
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
      startSynthesis: async (narrationTextCharactersBySegment) => {
        const executionEpoch = (await account.inspect()).executionEpoch;
        return account.startSynthesis(
          conversionId,
          narrationTextCharactersBySegment,
          executionEpoch,
        );
      },
      retryPreparation: () => account.retryPreparation(conversionId),
    };
  }

  const grant = env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(owner.grantId));
  return {
    startSynthesis: (narrationTextCharactersBySegment) =>
      grant.startSynthesis(conversionId, narrationTextCharactersBySegment),
    retryPreparation: () => grant.retryPreparation(conversionId),
  };
}
