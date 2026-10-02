import { generateSQLiteDrizzleJson } from "drizzle-kit/api";
import fs from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";

import * as accountSchema from "#src/account-sqlite-schema.ts";
import accountMigrations from "#src/migrations/account.ts";
import { rateEvents } from "#src/sqlite-schema-shared.ts";

const stores = [
  { name: "account", schema: { ...accountSchema, rateEvents }, bundle: accountMigrations },
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
    if (!latest) throw new Error(`Missing migration snapshot for ${name}`);
    const snapshot = z
      .object({ tables: z.unknown(), views: z.unknown() })
      .parse(JSON.parse(await fs.readFile(`drizzle/${name}/meta/${latest}`, "utf8")));
    const current = await generateSQLiteDrizzleJson(schema);
    expect(current.tables).toEqual(snapshot.tables);
    expect(current.views).toEqual(snapshot.views);
  });
}
