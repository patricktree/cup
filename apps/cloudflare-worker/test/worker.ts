/*
 * The integration test runtime's entry point (see wrangler.test.jsonc): exactly the production
 * Worker. Wrangler fails to start the test Worker when a Durable Object or Workflow class that
 * wrangler.test.jsonc binds is missing from the production entry's exports.
 */

export * from "#src/index.ts";
export { default } from "#src/index.ts";
