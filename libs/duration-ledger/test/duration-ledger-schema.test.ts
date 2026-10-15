import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import sqlite from "node:sqlite";
import { afterEach, beforeEach, expect, test } from "vitest";

import * as ledgerSchema from "#src/duration-ledger-schema.ts";

const conversions = sqliteTable("conversions", {
  conversionId: text("conversion_id").primaryKey(),
});
const audioSegments = ledgerSchema.defineAudioSegments(() => conversions.conversionId);

let database: sqlite.DatabaseSync;

beforeEach(async () => {
  database = new sqlite.DatabaseSync(":memory:");
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson({ ...ledgerSchema, conversions, audioSegments }),
  );
  for (const statement of statements) {
    database.exec(statement);
  }
  database.exec(`INSERT INTO conversions VALUES ('conversion');
    INSERT INTO credit_operations VALUES
      ('allowance', 'allowance', 'grant', 'audio-millisecond', 5000, 'completed', 'test'),
      ('segment', 'segment', 'reservation', 'audio-millisecond', 1000, 'reserved', 'conversion')`);
});

afterEach(() => {
  database.close();
});

test("ledger events must change balances as their kind requires", () => {
  database.exec(`INSERT INTO credit_ledger VALUES
    ('allowance:grant', 'allowance', 'grant', 'audio-millisecond', 5000, 5000, 0, 1, 'test'),
    ('segment:reserve', 'segment', 'reserve', 'audio-millisecond', 1000, -1000, 1000, 1, 'conversion'),
    ('segment:consume', 'segment', 'consume', 'audio-millisecond', 1200, -200, -1000, 2, 'conversion')`);

  expect(() =>
    database.exec(
      "INSERT INTO credit_ledger VALUES ('bad', 'allowance', 'adjustment', 'audio-millisecond', 10, 10, 5, 3, 'test')",
    ),
  ).toThrow(/CHECK constraint failed: credit_ledger_deltas/);
  expect(() =>
    database.exec(
      "INSERT INTO credit_ledger VALUES ('segment:release', 'segment', 'release', 'audio-millisecond', 1000, 1000, -1000, 3, 'conversion')",
    ),
  ).toThrow(/UNIQUE constraint failed/);
});

test("audio segments must be consistent with their state and reservation", () => {
  database.exec(
    "INSERT INTO audio_segments VALUES ('conversion', 0, 10, 1000, 'settled', 1200, 1000, 'segment')",
  );

  expect(() =>
    database.exec(
      "INSERT INTO audio_segments VALUES ('conversion', 1, 10, 1000, 'reserved', 500, 0, 'allowance')",
    ),
  ).toThrow(/CHECK constraint failed: audio_segment_state/);
  expect(() =>
    database.exec(
      "UPDATE audio_segments SET charged_milliseconds = actual_milliseconds + 1 WHERE sequence = 0",
    ),
  ).toThrow(/CHECK constraint failed: audio_segment_duration/);
  expect(() =>
    database.exec(
      "INSERT INTO audio_segments VALUES ('missing', 1, 10, 1000, 'reserved', 0, 0, 'allowance')",
    ),
  ).toThrow(/FOREIGN KEY constraint failed/);
});
