import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import fs from "node:fs/promises";
import sqlite from "node:sqlite";
import { expect, test } from "vitest";
import { z } from "zod";

import { readSchemaDiagram, renderSchemaDiagram } from "@cup/drizzle-migrations/schema-diagram";

import grantMigrations from "#src/migrations/grant.ts";
import * as grantSchema from "#src/storage/grant-sqlite-schema.ts";
import { rateEvents } from "#src/storage/rate-limit-schema.ts";

const STORAGE_PAGE = "../../docs/architecture/durable-object-storage.md";

const stores = [
  {
    name: "grant",
    schema: { ...grantSchema, rateEvents },
    bundle: grantMigrations,
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

  test(`${name} schema diagram is generated from the current schema`, async () => {
    const page = await fs.readFile(STORAGE_PAGE, "utf8");
    const current = await generateSQLiteDrizzleJson(schema);
    expect(
      readSchemaDiagram(page, name),
      "Run `pnpm migrations:generate` to regenerate the schema diagram",
    ).toBe(renderSchemaDiagram(current));
  });
}

test("moving start attempts into rate events keeps them counting toward the start limit", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    const { key, earlierKeys } = findMigration("shared_rate_events");
    const migrations: Record<string, string> = grantMigrations.migrations;
    for (const earlierKey of earlierKeys) {
      database.exec(migrations[earlierKey]!);
    }
    database.exec("INSERT INTO start_attempts (attempted_at_ms) VALUES (1000), (1000), (2500)");

    database.exec(migrations[key]!);

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

test("grant migrations create the current schema", async () => {
  const migrated = new sqlite.DatabaseSync(":memory:");
  const fresh = new sqlite.DatabaseSync(":memory:");
  try {
    applyMigrations(migrated, Object.keys(grantMigrations.migrations));
    for (const statement of await generateSQLiteMigration(
      await generateSQLiteDrizzleJson({}),
      await generateSQLiteDrizzleJson({ ...grantSchema, rateEvents }),
    )) {
      fresh.exec(statement);
    }
    expect(readSchema(migrated)).toEqual(readSchema(fresh));
  } finally {
    migrated.close();
    fresh.close();
  }
});

test("adopting the duration ledger turns allowance and segment usage into equal ledger balances", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    const { key, earlierKeys } = findMigration("adopt_duration_ledger");
    applyMigrations(database, earlierKeys);
    database.exec(`INSERT INTO grant (
      id, allowance_milliseconds, grant_id, created_at_ms, expires_at_ms, session_signing_key,
      signing_key_generation, projection_revision, registry_confirmed_revision
    ) VALUES (1, 20000, 'grant', 100, 1000, 'key', 1, 7, 7)`);
    database.exec(`INSERT INTO conversions (
      conversion_id, idempotency_key, source_url, accepted_at_ms, status, last_started_phase,
      completed_at_ms, title, audiobook_reference_json
    ) VALUES
      ('ready', 'key-ready', 'https://example.com/r', 200, 'ready', 'finalization', 300, 'Ready', '{}'),
      ('pending', 'key-pending', 'https://example.com/p', 400, 'pending', 'conversion-start', NULL, NULL, NULL)`);
    database.exec(
      `INSERT INTO segment_usage VALUES
      ('ready', 0, 10, 1000, 'settled', 1200, 1200, 0),
      ('ready', 1, 13, 1040, 'settled', 900, 0, 0),
      ('ready', 2, 25, 2000, 'reserved', 0, 0, 0),
      ('ready', 3, 38, 3000, 'released', 0, 0, 0)`.replaceAll(", 0)", ")"),
    );

    applyMigrations(database, [key]);

    expect(database.prepare("SELECT * FROM credit_balances").all()).toEqual([
      // 20,000 allowance - 1,200 spent - 2,000 reserved
      { unit: "audio-millisecond", available: 16_800, reserved: 2_000 },
    ]);
    expect(
      database
        .prepare(
          `SELECT
            SUM(CASE WHEN event_kind = 'grant' THEN amount ELSE 0 END) AS allowance,
            SUM(CASE WHEN event_kind = 'consume' THEN amount ELSE 0 END) AS spent,
            SUM(available_delta) AS available,
            SUM(reserved_delta) AS reserved
          FROM credit_ledger`,
        )
        .get(),
    ).toEqual({ allowance: 20_000, spent: 1_200, available: 16_800, reserved: 2_000 });
    expect(
      database
        .prepare(
          "SELECT operation_id, kind, amount, state FROM credit_operations ORDER BY operation_id",
        )
        .all(),
    ).toEqual([
      { operation_id: "allowance:grant", kind: "grant", amount: 20_000, state: "completed" },
      {
        operation_id: "segment:ready:0:migrated",
        kind: "reservation",
        amount: 1_000,
        state: "consumed",
      },
      {
        operation_id: "segment:ready:1:migrated",
        kind: "reservation",
        amount: 1_040,
        state: "consumed",
      },
      {
        operation_id: "segment:ready:2:migrated",
        kind: "reservation",
        amount: 2_000,
        state: "reserved",
      },
      {
        operation_id: "segment:ready:3:migrated",
        kind: "reservation",
        amount: 3_000,
        state: "released",
      },
    ]);
    expect(database.prepare("SELECT * FROM audio_segments ORDER BY sequence").all()).toEqual([
      {
        conversion_id: "ready",
        sequence: 0,
        narration_text_characters: 10,
        estimated_milliseconds: 1_000,
        state: "settled",
        actual_milliseconds: 1_200,
        charged_milliseconds: 1_200,
        operation_id: "segment:ready:0:migrated",
      },
      {
        conversion_id: "ready",
        sequence: 1,
        narration_text_characters: 13,
        estimated_milliseconds: 1_040,
        state: "settled",
        actual_milliseconds: 900,
        charged_milliseconds: 0,
        operation_id: "segment:ready:1:migrated",
      },
      {
        conversion_id: "ready",
        sequence: 2,
        narration_text_characters: 25,
        estimated_milliseconds: 2_000,
        state: "reserved",
        actual_milliseconds: 0,
        charged_milliseconds: 0,
        operation_id: "segment:ready:2:migrated",
      },
      {
        conversion_id: "ready",
        sequence: 3,
        narration_text_characters: 38,
        estimated_milliseconds: 3_000,
        state: "released",
        actual_milliseconds: 0,
        charged_milliseconds: 0,
        operation_id: "segment:ready:3:migrated",
      },
    ]);
    expect(database.prepare("SELECT * FROM grant").all()).toEqual([
      {
        id: 1,
        grant_id: "grant",
        created_at_ms: 100,
        expires_at_ms: 1_000,
        revoked_at_ms: null,
        credential_verifier: null,
        credential_issued_at_ms: null,
        session_signing_key: "key",
        signing_key_generation: 1,
        projection_revision: 7,
        registry_confirmed_revision: 7,
      },
    ]);
    expect(
      database
        .prepare("SELECT conversion_id, created_at_ms FROM conversions ORDER BY created_at_ms")
        .all(),
    ).toEqual([
      { conversion_id: "ready", created_at_ms: 200 },
      { conversion_id: "pending", created_at_ms: 400 },
    ]);
  } finally {
    database.close();
  }
});

test("adopting the duration ledger leaves an uninitialized grant without a balance", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    applyMigrations(database, Object.keys(grantMigrations.migrations));
    expect(database.prepare("SELECT * FROM credit_balances").all()).toEqual([]);
    expect(database.prepare("SELECT * FROM credit_ledger").all()).toEqual([]);
  } finally {
    database.close();
  }
});

/**
 * Finds a migration by its journal tag without its number prefix, so renumbering it after a rebase
 * keeps the test valid; also returns the keys of all migrations that run before it.
 */
function findMigration(name: string) {
  const keys = Object.keys(grantMigrations.migrations);
  const index = grantMigrations.journal.entries.findIndex((entry) =>
    entry.tag.endsWith(`_${name}`),
  );
  if (index === -1) {
    throw new Error(`Missing grant migration ${name}`);
  }
  return { key: keys[index]!, earlierKeys: keys.slice(0, index) };
}

/** Runs migrations in one transaction with enforced foreign keys, like the Durable Object migrator. */
function applyMigrations(database: sqlite.DatabaseSync, keys: string[]) {
  const migrations: Record<string, string> = grantMigrations.migrations;
  database.exec("BEGIN");
  for (const key of keys) {
    for (const statement of migrations[key]!.split("--> statement-breakpoint")) {
      database.exec(statement);
    }
  }
  database.exec("COMMIT");
}

/**
 * Compares schema objects independently of identifier quoting, whitespace, and column order;
 * columns added by `ALTER TABLE` are appended, while a fresh baseline lists them in schema order.
 */
function readSchema(database: sqlite.DatabaseSync) {
  return database
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all()
    .map((row) => {
      const sql = String(row["sql"])
        .replaceAll("`", '"')
        .replaceAll(/\s+/g, " ")
        .replaceAll("( ", "(")
        .replaceAll(" )", ")");
      return { ...row, sql: row["type"] === "table" ? splitTableDefinition(sql) : sql };
    });
}

/** Splits a `CREATE TABLE` statement into its sorted top-level column and constraint clauses. */
function splitTableDefinition(sql: string) {
  const bodyStart = sql.indexOf("(");
  const clauses: string[] = [];
  let depth = 0;
  let clauseStart = bodyStart + 1;
  for (let index = bodyStart + 1; index < sql.lastIndexOf(")"); index += 1) {
    if (sql[index] === "(") {
      depth += 1;
    } else if (sql[index] === ")") {
      depth -= 1;
    } else if (sql[index] === "," && depth === 0) {
      clauses.push(sql.slice(clauseStart, index).trim());
      clauseStart = index + 1;
    }
  }
  clauses.push(sql.slice(clauseStart, sql.lastIndexOf(")")).trim());
  return { head: sql.slice(0, bodyStart).trim(), clauses: clauses.toSorted() };
}
