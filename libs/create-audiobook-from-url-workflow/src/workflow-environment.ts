import type { AccountDurableObject } from "@cup/accounts";
import type { ConversionGrantDurableObject } from "@cup/conversion-grants";

export type AudiobookWorkflowEnvironment = {
  AUDIO_BUCKET: R2Bucket;
  ACCOUNTS: DurableObjectNamespace<AccountDurableObject>;
  CONVERSION_GRANTS: DurableObjectNamespace<ConversionGrantDurableObject>;
};
