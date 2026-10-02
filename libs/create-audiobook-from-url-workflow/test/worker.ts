export { AccountDurableObject } from "@cup/accounts";
export { ConversionGrantDurableObject } from "@cup/conversion-grants";

export default {
  fetch: () => new Response("Workflow integration test Worker"),
} satisfies ExportedHandler;

export { RegistryDurableObject } from "@cup/registry";
