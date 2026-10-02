export { AccountDurableObject } from "#src/index.ts";
export default { fetch: () => new Response("Account test Worker") } satisfies ExportedHandler;
