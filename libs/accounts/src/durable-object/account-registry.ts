import type { ConversionOwner } from "@cup/conversion-contracts";

import type { AccountUsageProjection } from "#src/domain/account-contracts.ts";
import type { DeletionAttempt } from "#src/storage/account-lifecycle.ts";

/** Account operations need ownership, usage projection, and deletion RPCs from the registry. */
export type AccountRegistry = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): {
    bindConversionOwner(conversionId: string, owner: ConversionOwner): Promise<void>;
    acceptDeletionAttempt(attempt: DeletionAttempt): Promise<void>;
    removeAccountConversionOwners(accountId: string): Promise<void>;
    applyAccountUsageProjection(
      projection: AccountUsageProjection,
    ): Promise<"applied" | "replayed" | "stale">;
  };
};
