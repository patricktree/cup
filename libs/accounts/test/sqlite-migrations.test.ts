import { generateSQLiteDrizzleJson } from "drizzle-kit/api";
import fs from "node:fs/promises";
import sqlite from "node:sqlite";
import { expect, test } from "vitest";
import { z } from "zod";

import * as accountSchema from "#src/account-sqlite-schema.ts";
import accountMigrations from "#src/migrations/account.ts";
import { rateEvents } from "#src/rate-limit-schema.ts";

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

test("removing writer purpose preserves outstanding storage effects", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    for (const [key, migration] of Object.entries(accountMigrations.migrations)) {
      if (key === "m0003") {
        break;
      }
      database.exec(migration);
    }
    database.exec(
      "INSERT INTO artifact_writers (writer_id, execution_epoch, prefix, state, unresolved_effect, purpose) VALUES ('writer', 1, 'accounts/account/conversions/conversion/', 'running', 'put:accounts/account/conversions/conversion/audio-segments/0.mp3', 'production')",
    );
    database.exec(accountMigrations.migrations.m0003);
    expect(database.prepare("SELECT * FROM artifact_writers").all()).toEqual([
      {
        writer_id: "writer",
        execution_epoch: 1,
        prefix: "accounts/account/conversions/conversion/",
        state: "running",
        unresolved_effect: "put:accounts/account/conversions/conversion/audio-segments/0.mp3",
      },
    ]);
  } finally {
    database.close();
  }
});

test("deletion state checks preserve stored rows and reject unsupported values", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    for (const [key, migration] of Object.entries(accountMigrations.migrations)) {
      if (key === "m0004") {
        break;
      }
      database.exec(migration);
    }
    database.exec(
      "INSERT INTO deletion_attempts (attempt_id, payload_json, state) VALUES ('scheduled', '{}', 'scheduled')",
    );
    database.exec("INSERT INTO deletion_attempts VALUES ('restored', '{}', 'restored', 1)");
    database.exec("INSERT INTO deletion_attempts VALUES ('deleting', '{}', 'deleting', 0)");
    database.exec(
      "INSERT INTO deletion_challenges (challenge_id, execution_epoch, state, issued_at_ms, expires_at_ms) VALUES ('active', 1, 'active', 1, 2)",
    );
    database.exec(
      "INSERT INTO deletion_challenges VALUES ('scheduled', 1, 'deletion_scheduled', 1, 2, 1)",
    );
    const attempts = database.prepare("SELECT * FROM deletion_attempts ORDER BY rowid").all();
    const challenges = database.prepare("SELECT * FROM deletion_challenges ORDER BY rowid").all();

    database.exec(accountMigrations.migrations.m0004);

    expect(database.prepare("SELECT * FROM deletion_attempts ORDER BY rowid").all()).toEqual(
      attempts,
    );
    expect(database.prepare("SELECT * FROM deletion_challenges ORDER BY rowid").all()).toEqual(
      challenges,
    );
    for (const statement of [
      "UPDATE deletion_attempts SET state = 'erased'",
      "UPDATE deletion_attempts SET delivered = 2",
      "UPDATE deletion_challenges SET state = 'deleting'",
      "UPDATE deletion_challenges SET used = 2",
    ]) {
      expect(() => database.exec(statement)).toThrow(/CHECK constraint failed/);
    }
  } finally {
    database.close();
  }
});
