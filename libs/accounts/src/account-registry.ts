import type { ConversionOwner } from "@cup/conversion-contracts";

import type { DeletionAttempt } from "#src/account-lifecycle.ts";

/** Account operations need ownership and deletion RPCs from the shared registry. */
export type AccountRegistry = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): {
    bindConversionOwner(conversionId: string, owner: ConversionOwner): Promise<void>;
    acceptDeletionAttempt(attempt: DeletionAttempt): Promise<void>;
    removeAccountConversionOwners(accountId: string): Promise<void>;
  };
};
