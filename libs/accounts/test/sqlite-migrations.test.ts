import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
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
    const { key, earlierKeys } = findMigration("remove_artifact_writer_purpose");
    const migrations: Record<string, string> = accountMigrations.migrations;
    for (const earlierKey of earlierKeys) {
      database.exec(migrations[earlierKey]!);
    }
    database.exec(
      "INSERT INTO artifact_writers (writer_id, execution_epoch, prefix, state, unresolved_effect, purpose) VALUES ('writer', 1, 'accounts/account/conversions/conversion/', 'running', 'put:accounts/account/conversions/conversion/audio-segments/0.mp3', 'production')",
    );
    database.exec(migrations[key]!);
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
    const { key, earlierKeys } = findMigration("deletion_state_checks");
    const migrations: Record<string, string> = accountMigrations.migrations;
    for (const earlierKey of earlierKeys) {
      database.exec(migrations[earlierKey]!);
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

    database.exec(migrations[key]!);

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

test("account migrations create the current schema", async () => {
  const migrated = new sqlite.DatabaseSync(":memory:");
  const fresh = new sqlite.DatabaseSync(":memory:");
  try {
    applyMigrations(migrated, Object.keys(accountMigrations.migrations));
    const schema = await generateSQLiteDrizzleJson({ ...accountSchema, rateEvents });
    for (const statement of await generateSQLiteMigration(
      await generateSQLiteDrizzleJson({}),
      schema,
    )) {
      fresh.exec(statement);
    }
    expect(readSchema(migrated)).toEqual(readSchema(fresh));
  } finally {
    migrated.close();
    fresh.close();
  }
});

test("aligning with the shared duration ledger preserves conversions, jobs, and segments", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    const { key, earlierKeys } = findMigration("align_duration_ledger_schema");
    applyMigrations(database, earlierKeys);
    const reference = {
      key: "accounts/account/conversions/ready/audiobook.json",
      contentType: "application/json",
      byteLength: 10,
      etag: "etag",
    };
    const insertConversion = database.prepare(
      "INSERT INTO account_conversions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertConversion.run(
      "pending",
      "key-pending",
      "https://example.com/p",
      "{}",
      1,
      "pending",
      null,
      null,
    );
    insertConversion.run(
      "ready",
      "key-ready",
      "https://example.com/r",
      "{}",
      2,
      "ready",
      JSON.stringify({
        audiobookReference: reference,
        hasCoverImage: true,
        status: "ready",
        title: "Ready",
      }),
      3,
    );
    insertConversion.run(
      "plain",
      "key-plain",
      "https://example.com/plain",
      "{}",
      4,
      "ready",
      JSON.stringify({ audiobookReference: reference, status: "ready", title: "Plain" }),
      5,
    );
    insertConversion.run(
      "failed",
      "key-failed",
      "https://example.com/f",
      "{}",
      6,
      "failed",
      JSON.stringify({
        explanation: "Stopped.",
        failureCategory: "execution-failed",
        status: "failed",
      }),
      7,
    );
    database.exec(
      "INSERT INTO pending_jobs VALUES ('job', 'pending', 1, 'pending'), ('job-ready', 'ready', 1, 'delivered')",
    );
    const insertOperation = database.prepare(
      "INSERT INTO credit_operations VALUES (?, ?, 'reservation', 'audio-millisecond', ?, ?, 'ready')",
    );
    insertOperation.run("op-0", "op-0", 1_000, "consumed");
    insertOperation.run("op-1", "op-1", 2_000, "reserved");
    insertOperation.run("op-2", "op-2", 3_000, "released");
    database.exec(`INSERT INTO account_audio_segments VALUES
      ('ready', 0, 10, 1000, 'settled', 1200, 900, 'op-0'),
      ('ready', 1, 25, 2000, 'reserved', 0, 0, 'op-1'),
      ('ready', 2, 38, 3000, 'released', 0, 0, 'op-2')`);

    applyMigrations(database, [key]);

    expect(
      database.prepare("SELECT * FROM account_conversions ORDER BY created_at_ms").all(),
    ).toEqual([
      {
        conversion_id: "pending",
        idempotency_key: "key-pending",
        source_url: "https://example.com/p",
        created_at_ms: 1,
        status: "pending",
        completed_at_ms: null,
        title: null,
        audiobook_reference_json: null,
        has_cover_image: null,
        failure_category: null,
        explanation: null,
      },
      {
        conversion_id: "ready",
        idempotency_key: "key-ready",
        source_url: "https://example.com/r",
        created_at_ms: 2,
        status: "ready",
        completed_at_ms: 3,
        title: "Ready",
        audiobook_reference_json: JSON.stringify(reference),
        has_cover_image: 1,
        failure_category: null,
        explanation: null,
      },
      {
        conversion_id: "plain",
        idempotency_key: "key-plain",
        source_url: "https://example.com/plain",
        created_at_ms: 4,
        status: "ready",
        completed_at_ms: 5,
        title: "Plain",
        audiobook_reference_json: JSON.stringify(reference),
        has_cover_image: null,
        failure_category: null,
        explanation: null,
      },
      {
        conversion_id: "failed",
        idempotency_key: "key-failed",
        source_url: "https://example.com/f",
        created_at_ms: 6,
        status: "failed",
        completed_at_ms: 7,
        title: null,
        audiobook_reference_json: null,
        has_cover_image: null,
        failure_category: "execution-failed",
        explanation: "Stopped.",
      },
    ]);
    expect(database.prepare("SELECT * FROM pending_jobs ORDER BY job_id").all()).toEqual([
      { job_id: "job", conversion_id: "pending", execution_epoch: 1, state: "pending" },
      { job_id: "job-ready", conversion_id: "ready", execution_epoch: 1, state: "delivered" },
    ]);
    expect(database.prepare("SELECT * FROM audio_segments ORDER BY sequence").all()).toEqual([
      {
        conversion_id: "ready",
        sequence: 0,
        narration_text_characters: 10,
        estimated_milliseconds: 1_000,
        state: "settled",
        actual_milliseconds: 1_200,
        charged_milliseconds: 900,
        operation_id: "op-0",
      },
      {
        conversion_id: "ready",
        sequence: 1,
        narration_text_characters: 25,
        estimated_milliseconds: 2_000,
        state: "reserved",
        actual_milliseconds: 0,
        charged_milliseconds: 0,
        operation_id: "op-1",
      },
      {
        conversion_id: "ready",
        sequence: 2,
        narration_text_characters: 38,
        estimated_milliseconds: 3_000,
        state: "released",
        actual_milliseconds: 0,
        charged_milliseconds: 0,
        operation_id: "op-2",
      },
    ]);
    expect(() =>
      database.exec("INSERT INTO pending_jobs VALUES ('orphan', 'missing', 1, 'pending')"),
    ).toThrow(/FOREIGN KEY constraint failed/);
  } finally {
    database.close();
  }
});

test("tracking the registry's usage confirmation keeps the account and starts unconfirmed", () => {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    const { key, earlierKeys } = findMigration("registry_usage_projection");
    applyMigrations(database, earlierKeys);
    database.exec(
      "INSERT INTO account VALUES (1, 'account', 'subject', 1, 'deletion_scheduled', 2, 3)",
    );

    applyMigrations(database, [key]);

    expect(database.prepare("SELECT * FROM account").all()).toEqual([
      {
        id: 1,
        account_id: "account",
        subject: "subject",
        created_at_ms: 1,
        state: "deletion_scheduled",
        execution_epoch: 2,
        recovery_deadline_ms: 3,
        registry_confirmed_revision: 0,
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
  const keys = Object.keys(accountMigrations.migrations);
  const index = accountMigrations.journal.entries.findIndex((entry) =>
    entry.tag.endsWith(`_${name}`),
  );
  if (index === -1) {
    throw new Error(`Missing account migration ${name}`);
  }
  return { key: keys[index]!, earlierKeys: keys.slice(0, index) };
}

/** Runs migrations in one transaction with enforced foreign keys, like the Durable Object migrator. */
function applyMigrations(database: sqlite.DatabaseSync, keys: string[]) {
  const migrations: Record<string, string> = accountMigrations.migrations;
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
