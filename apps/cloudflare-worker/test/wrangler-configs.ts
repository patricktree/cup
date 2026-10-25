import nodeUrl from "node:url";
import { experimental_readRawConfig } from "wrangler";
import { z } from "zod";

export type WranglerConfig = z.infer<typeof wranglerConfigSchema>;
export type DurableObjectMigration = NonNullable<WranglerConfig["migrations"]>[number];

/** The production config, which `pnpm dev` and `wrangler deploy` use. */
export const PRODUCTION_CONFIG_PATH = nodeUrl.fileURLToPath(
  new URL("../wrangler.jsonc", import.meta.url),
);

/** The integration tests' config (`useWorker()`). */
export const TEST_CONFIG_PATH = nodeUrl.fileURLToPath(
  new URL("wrangler.test.jsonc", import.meta.url),
);

/**
 * The parts of a Wrangler config that the tests read. Wrangler's declarations import the config
 * types from a package it bundles, so `experimental_readRawConfig()` returns `any`; this schema
 * gives the tests checked types instead. Unlisted keys pass through untouched.
 */
const wranglerConfigSchema = z.looseObject({
  routes: z
    .array(z.strictObject({ pattern: z.string(), custom_domain: z.boolean().optional() }))
    .optional(),
  workers_dev: z.boolean().optional(),
  preview_urls: z.boolean().optional(),
  compatibility_date: z.string().optional(),
  compatibility_flags: z.array(z.string()).optional(),
  assets: z.record(z.string(), z.unknown()).optional(),
  durable_objects: z
    .strictObject({
      bindings: z.array(z.strictObject({ name: z.string(), class_name: z.string() })),
    })
    .optional(),
  migrations: z
    .array(
      z.strictObject({
        tag: z.string(),
        new_classes: z.array(z.string()).optional(),
        new_sqlite_classes: z.array(z.string()).optional(),
        renamed_classes: z.array(z.strictObject({ from: z.string(), to: z.string() })).optional(),
        deleted_classes: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  workflows: z
    .array(z.strictObject({ name: z.string(), binding: z.string(), class_name: z.string() }))
    .optional(),
  r2_buckets: z.array(z.strictObject({ binding: z.string(), bucket_name: z.string() })).optional(),
  vars: z.record(z.string(), z.string()).optional(),
  secrets: z.strictObject({ required: z.array(z.string()) }).optional(),
  ai: z.unknown().optional(),
  browser: z.unknown().optional(),
  observability: z.unknown().optional(),
});

export function readWranglerConfig(configPath: string): WranglerConfig {
  const { rawConfig }: { rawConfig: unknown } = experimental_readRawConfig({ config: configPath });
  return wranglerConfigSchema.parse(rawConfig);
}
