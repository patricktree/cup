import { generateSQLiteDrizzleJson } from "drizzle-kit/api";
import fs from "node:fs/promises";
import sqlite from "node:sqlite";
import { expect, test } from "vitest";
import { z } from "zod";

import * as grantSchema from "#src/grant-sqlite-schema.ts";
import grantMigrations from "#src/migrations/grant.ts";
import { rateEvents } from "#src/rate-limit-schema.ts";

const stores = [{ name: "grant", schema: { ...grantSchema, rateEvents }, bundle: grantMigrations }];

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

test("moving start attempts into rate events keeps them counting toward the start limit", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    for (const [key, migration] of Object.entries(grantMigrations.migrations)) {
      if (key === "m0002") {
        break;
      }
      database.exec(migration);
    }
    database.exec("INSERT INTO start_attempts (attempted_at_ms) VALUES (1000), (1000), (2500)");

    database.exec(grantMigrations.migrations.m0002);

    expect(
      database
        .prepare(
          "SELECT bucket, event_id, created_at_ms, expires_at_ms FROM rate_events ORDER BY event_id",
        )
        .all(),
    ).toEqual([
      {
        bucket: "grant-conversion-start",
        event_id: "start-attempt-1",
        created_at_ms: 1000,
        expires_at_ms: 61_000,
      },
      {
        bucket: "grant-conversion-start",
        event_id: "start-attempt-2",
        created_at_ms: 1000,
        expires_at_ms: 61_000,
      },
      {
        bucket: "grant-conversion-start",
        event_id: "start-attempt-3",
        created_at_ms: 2500,
        expires_at_ms: 62_500,
      },
    ]);
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE name = 'start_attempts'").all(),
    ).toEqual([]);
  } finally {
    database.close();
  }
});
