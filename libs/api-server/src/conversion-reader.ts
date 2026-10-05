import {
  createConversionArtifactPrefix,
  type AudiobookReference,
  type ConversionOwner,
} from "@cup/conversion-contracts";
import type { SegmentUsage } from "@cup/conversion-contracts/duration-accounting";
import type { GrantConversion } from "@cup/conversion-grants";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";

export type ConversionReader = {
  artifactPrefix: string;
  getConversion(): Promise<Pick<GrantConversion, "sourceUrl" | "status"> | undefined>;
  getReadyAudiobookReference(): Promise<AudiobookReference | undefined>;
  listAudioSegments(): Promise<
    readonly Pick<SegmentUsage, "sequence" | "state" | "actualMilliseconds">[]
  >;
};

/** Internal reads require request authorization before resolving the conversion reader. */
export function resolveConversionReader(
  env: ApiServerEnvironment,
  conversionId: string,
  owner: ConversionOwner,
): ConversionReader {
  const artifactPrefix = createConversionArtifactPrefix(conversionId, owner);

  if (owner.kind === "account") {
    const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner.accountId));
    return {
      artifactPrefix,
      getConversion: () => account.getConversion(conversionId),
      getReadyAudiobookReference: async () => {
        if ((await account.inspect()).state !== "active") return undefined;
        const outcome = (await account.getConversion(conversionId))?.outcome;
        if (outcome?.status !== "ready") return undefined;
        if (outcome.audiobookReference.key !== `${artifactPrefix}audiobook.json`)
          throw new Error("Private manifest ownership mismatch");
        return outcome.audiobookReference;
      },
      listAudioSegments: () => account.listAudioSegments(conversionId),
    };
  }

  const grant = env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(owner.grantId));
  return {
    artifactPrefix,
    getConversion: () => grant.getConversion(conversionId),
    getReadyAudiobookReference: () => grant.getReadyAudiobookReference(conversionId),
    listAudioSegments: () => grant.listAudioSegments(conversionId),
  };
}
