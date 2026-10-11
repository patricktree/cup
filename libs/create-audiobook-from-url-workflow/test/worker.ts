import { WorkflowEntrypoint } from "cloudflare:workers";

import { AccountDurableObject as BaseAccountDurableObject } from "@cup/accounts";
import { ConversionGrantDurableObject as BaseConversionGrantDurableObject } from "@cup/conversion-grants";

/** Lets tests run the owner alarm without waiting for its schedule. */
export class AccountDurableObject extends BaseAccountDurableObject {
  reconcileForTest() {
    return this.alarm();
  }
}

/** Lets tests run the owner alarm without waiting for its schedule. */
export class ConversionGrantDurableObject extends BaseConversionGrantDurableObject {
  reconcileForTest() {
    return this.alarm();
  }
}

/** Accepts dispatches from the owners; tests run segment synthesis themselves. */
export class DispatchedAudioSegmentWorkflow extends WorkflowEntrypoint {
  override async run() {}
}

export default {
  fetch: () => new Response("Workflow integration test Worker"),
} satisfies ExportedHandler;

export { RegistryDurableObject } from "@cup/registry";
