import { generateSQLiteDrizzleJson } from "drizzle-kit/api";
import fs from "node:fs/promises";
import sqlite from "node:sqlite";
import { expect, test } from "vitest";
import { z } from "zod";

import registryMigrations from "#src/migrations/registry.ts";
import { rateEvents } from "#src/storage/rate-limit-schema.ts";
import * as registrySchema from "#src/storage/registry-sqlite-schema.ts";

const stores = [
  {
    name: "registry",
    schema: { ...registrySchema, rateEvents },
    bundle: registryMigrations,
  },
];

for (const { name, schema, bundle } of stores) {
  test(`${name} migration bundle matches the checked-in SQL and journal`, async () => {
    const journal: unknown = JSON.parse(
      await fs.readFile(`drizzle/${name}/meta/_journal.json`, "utf8"),
    );
    expect(bundle.journal).toEqual(journal);
    const bundledSql: Record<string, string> = bundle.migrations;
    expect(Object.keys(bundledSql)).toHaveLength(bundle.journal.entries.length);
    for (const entry of bundle.journal.entries) {
      const sql = await fs.readFile(`drizzle/${name}/${entry.tag}.sql`, "utf8");
      expect(bundledSql[`m${String(entry.idx).padStart(4, "0")}`]).toBe(sql);
    }
  });

  test(`${name} schema matches its latest migration snapshot`, async () => {
    const snapshots = (await fs.readdir(`drizzle/${name}/meta`))
      .filter((file) => file.endsWith("_snapshot.json"))
      .sort();
    const latest = snapshots.at(-1);
    if (!latest) {
      throw new Error(`Missing migration snapshot for ${name}`);
    }
    const snapshot = z
      .object({ tables: z.unknown(), views: z.unknown() })
      .parse(JSON.parse(await fs.readFile(`drizzle/${name}/meta/${latest}`, "utf8")));
    const current = await generateSQLiteDrizzleJson(schema);
    expect(current.tables).toEqual(snapshot.tables);
    expect(current.views).toEqual(snapshot.views);
  });
}

test("adding account usage projections keeps identities and leaves them unprojected", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    const { key, earlierKeys } = findMigration("account_usage_projection");
    applyMigrations(database, earlierKeys);
    database.exec(
      "INSERT INTO identity_accounts VALUES ('subject', 'account', 1, 'active'), ('fenced', 'other', 2, 'deleting_identity')",
    );

    applyMigrations(database, [key]);

    const unprojected = {
      projection_revision: null,
      projection_allowance_milliseconds: null,
      projection_reserved_milliseconds: null,
      projection_spent_milliseconds: null,
      projection_schema_version: null,
    };
    expect(
      database.prepare("SELECT * FROM identity_accounts ORDER BY created_at_ms").all(),
    ).toEqual([
      {
        subject: "subject",
        account_id: "account",
        created_at_ms: 1,
        phase: "active",
        ...unprojected,
      },
      {
        subject: "fenced",
        account_id: "other",
        created_at_ms: 2,
        phase: "deleting_identity",
        ...unprojected,
      },
    ]);
  } finally {
    database.close();
  }
});

/**
 * Finds a migration by its journal tag without its number prefix, so renumbering it after a rebase
 * keeps the test valid; also returns the keys of all migrations that run before it.
 */
function findMigration(name: string) {
  const keys = Object.keys(registryMigrations.migrations);
  const index = registryMigrations.journal.entries.findIndex((entry) =>
    entry.tag.endsWith(`_${name}`),
  );
  if (index === -1) {
    throw new Error(`Missing registry migration ${name}`);
  }
  return { key: keys[index]!, earlierKeys: keys.slice(0, index) };
}

function applyMigrations(database: sqlite.DatabaseSync, keys: string[]) {
  const migrations: Record<string, string> = registryMigrations.migrations;
  database.exec("BEGIN");
  for (const key of keys) {
    for (const statement of migrations[key]!.split("--> statement-breakpoint")) {
      database.exec(statement);
    }
  }
  database.exec("COMMIT");
}
