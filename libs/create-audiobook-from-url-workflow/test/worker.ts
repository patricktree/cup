export {
  ConversionGrantDurableObject,
  ConversionGrantRegistryDurableObject,
} from "@cup/conversion-grants";

export default {
  fetch: () => new Response("Workflow integration test Worker"),
} satisfies ExportedHandler;
