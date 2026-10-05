import type { AccountDurableObject } from "@cup/accounts";
import type { SegmentWorkflowParams } from "@cup/conversion-contracts";
import type { ConversionGrantDurableObject } from "@cup/conversion-grants";
import type { ConversionParams } from "@cup/create-audiobook-from-url-workflow/runner";
import type { RegistryDurableObject } from "@cup/registry";

export type ApiServerEnvironment = {
  LOCAL_DEVELOPMENT: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  GOOGLE_WEB_CLIENT_ID: string;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  ACCOUNTS: DurableObjectNamespace<AccountDurableObject>;
  REGISTRY: DurableObjectNamespace<RegistryDurableObject>;
  PREPARE_AUDIOBOOK_WORKFLOW: Workflow<ConversionParams>;
  SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW: Workflow<SegmentWorkflowParams>;
  ASSETS: Fetcher;
  AUDIO_BUCKET: R2Bucket;
  CONVERSION_GRANTS: DurableObjectNamespace<ConversionGrantDurableObject>;
  OPERATOR_ACCESS_ISSUER: string;
  OPERATOR_ACCESS_AUDIENCE: string;
  OPERATOR_EMAIL: string;
};
