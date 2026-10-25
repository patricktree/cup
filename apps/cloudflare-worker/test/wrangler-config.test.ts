import fs from "node:fs/promises";
import { test } from "vitest";

import { TEST_SECRETS } from "#test/use-worker.ts";
import {
  PRODUCTION_CONFIG_PATH,
  readWranglerConfig,
  TEST_CONFIG_PATH,
  type DurableObjectMigration,
} from "#test/wrangler-configs.ts";

const TERRAFORM_SUPABASE_URL = new URL(
  "../../../terraform/production/supabase.tf",
  import.meta.url,
);

function readProductionConfig() {
  return readWranglerConfig(PRODUCTION_CONFIG_PATH);
}

/** The integration tests' config, which must bind the production resources minus paid services. */
function readTestConfig() {
  return readWranglerConfig(TEST_CONFIG_PATH);
}

test("the Worker is served only on its custom domains", ({ expect }) => {
  const config = readProductionConfig();

  // libs/api-server/src/domain-routing.ts redirects the other hostnames to cup.audio; routing.test.ts
  // checks that for each route listed here.
  expect(config.routes).toStrictEqual([
    { pattern: "cup.audio", custom_domain: true },
    { pattern: "www.cup.audio", custom_domain: true },
    { pattern: "www.cup-audio.com", custom_domain: true },
    { pattern: "cup-audio.com", custom_domain: true },
    { pattern: "create-audiobook-from-url.patricktree.me", custom_domain: true },
  ]);
  expect(config.workers_dev).toBe(false);
  expect(config.preview_urls).toBe(false);
});

test("the canonical custom domain is the site URL that Terraform configures for Supabase Auth", async ({
  expect,
}) => {
  const terraform = await fs.readFile(TERRAFORM_SUPABASE_URL, "utf8");
  const siteUrl = /site_url\s*=\s*"([^"]+)"/.exec(terraform)?.[1];

  expect(siteUrl).toBeDefined();
  expect(readProductionConfig().routes?.[0]).toStrictEqual({
    pattern: new URL(siteUrl ?? "").hostname,
    custom_domain: true,
  });
});

test("the integration tests run on the production compatibility settings", ({ expect }) => {
  const production = readProductionConfig();
  const testConfig = readTestConfig();

  expect(production.compatibility_flags).toStrictEqual(["nodejs_compat"]);
  expect(testConfig.compatibility_flags).toStrictEqual(production.compatibility_flags);
  expect(testConfig.compatibility_date).toBe(production.compatibility_date);
});

test("every request reaches the Worker before static assets", ({ expect }) => {
  const production = readProductionConfig();
  const testConfig = readTestConfig();

  const expectedAssets = {
    binding: "ASSETS",
    not_found_handling: "none",
    html_handling: "none",
    run_worker_first: true,
  };
  expect(production.assets).toStrictEqual(expectedAssets);
  expect(testConfig.assets).toStrictEqual({ ...expectedAssets, directory: "./assets" });
});

test("the Durable Object bindings are stable and the integration tests bind the same classes", ({
  expect,
}) => {
  const production = readProductionConfig();

  const expectedBindings = [
    { name: "ACCOUNTS", class_name: "AccountDurableObject" },
    { name: "CONVERSION_GRANTS", class_name: "ConversionGrantDurableObject" },
    { name: "REGISTRY", class_name: "RegistryDurableObject" },
  ];
  expect(production.durable_objects?.bindings).toStrictEqual(expectedBindings);
  expect(readTestConfig().durable_objects?.bindings).toStrictEqual(expectedBindings);
});

// Deployed migrations are history: Cloudflare rejects a deploy whose earlier migrations changed.
test("the deployed Durable Object migrations are never rewritten", ({ expect }) => {
  expect(readProductionConfig().migrations).toStrictEqual([
    {
      tag: "v1",
      new_sqlite_classes: ["ConversionGrantDurableObject", "ConversionGrantRegistryDurableObject"],
    },
    { tag: "v2", new_sqlite_classes: ["AccountDurableObject"] },
    {
      tag: "v3",
      renamed_classes: [
        { from: "ConversionGrantRegistryDurableObject", to: "RegistryDurableObject" },
      ],
    },
  ]);
});

test.for([
  { name: "production", configPath: PRODUCTION_CONFIG_PATH },
  { name: "integration test", configPath: TEST_CONFIG_PATH },
])(
  "the $name migrations make exactly the bound Durable Object classes SQLite-backed",
  ({ configPath }, { expect }) => {
    const config = readWranglerConfig(configPath);

    const boundClassNames = (config.durable_objects?.bindings ?? []).map(
      (binding) => binding.class_name,
    );
    expect([...collectSqliteClassNames(config.migrations ?? [])].toSorted()).toStrictEqual(
      boundClassNames.toSorted(),
    );
  },
);

test("the Workflow bindings are stable and the integration tests bind the same classes", ({
  expect,
}) => {
  const production = readProductionConfig();
  const testConfig = readTestConfig();

  expect(production.workflows).toStrictEqual([
    {
      name: "prepare-audiobook",
      binding: "PREPARE_AUDIOBOOK_WORKFLOW",
      class_name: "PrepareAudiobookWorkflow",
    },
    {
      name: "synthesize-audio-segment",
      binding: "SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW",
      class_name: "SynthesizeAudioSegmentWorkflow",
    },
  ]);
  expect(
    testConfig.workflows?.map(({ binding, class_name }) => ({ binding, class_name })),
  ).toStrictEqual(
    production.workflows?.map(({ binding, class_name }) => ({ binding, class_name })),
  );
});

test("the integration tests bind no paid service, and otherwise the production bindings", ({
  expect,
}) => {
  const production = readProductionConfig();
  const testConfig = readTestConfig();

  expect(production.ai).toStrictEqual({ binding: "AI" });
  expect(production.browser).toStrictEqual({ binding: "BROWSER" });
  expect(testConfig.ai).toBeUndefined();
  expect(testConfig.browser).toBeUndefined();
  expect(testConfig.r2_buckets?.map(({ binding }) => binding)).toStrictEqual(
    production.r2_buckets?.map(({ binding }) => binding),
  );
  expect(Object.keys(testConfig.vars ?? {}).toSorted()).toStrictEqual(
    Object.keys(production.vars ?? {}).toSorted(),
  );
});

test("the production secrets are required, and the integration tests supply each of them", ({
  expect,
}) => {
  const production = readProductionConfig();

  const expectedSecrets = [
    "CLOUDFLARE_API_KEY",
    "SOURCE_PAGE_COOKIES_JSON",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "GOOGLE_WEB_CLIENT_ID",
    "RESEND_API_KEY",
  ];
  expect(production.secrets).toStrictEqual({ required: expectedSecrets });
  expect(Object.keys(TEST_SECRETS)).toStrictEqual(expectedSecrets);
});

test("observability records every invocation's logs and traces", ({ expect }) => {
  expect(readProductionConfig().observability).toStrictEqual({
    enabled: true,
    logs: { enabled: true, invocation_logs: true },
    traces: { enabled: true, head_sampling_rate: 1 },
  });
});

/** The SQLite-backed classes that remain after applying every migration in order. */
function collectSqliteClassNames(migrations: DurableObjectMigration[]): Set<string> {
  const classNames = new Set<string>();
  for (const migration of migrations) {
    for (const className of migration.new_sqlite_classes ?? []) {
      classNames.add(className);
    }
    for (const { from, to } of migration.renamed_classes ?? []) {
      if (!classNames.delete(from)) {
        throw new Error(`Migration ${migration.tag} renames the unknown class ${from}.`);
      }
      classNames.add(to);
    }
    for (const className of migration.deleted_classes ?? []) {
      classNames.delete(className);
    }
    if ((migration.new_classes ?? []).length > 0) {
      throw new Error(`Migration ${migration.tag} adds a class without SQLite storage.`);
    }
  }
  return classNames;
}
