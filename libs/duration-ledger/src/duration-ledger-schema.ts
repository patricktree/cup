import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

/**
 * Tables shared by every duration allowance owner. Each owner's Durable Object keeps its own copy;
 * owner schemas re-export these tables so that their migrations create them.
 */
export const creditBalances = sqliteTable(
  "credit_balances",
  {
    unit: text({ enum: ["audio-millisecond"] }).primaryKey(),
    available: integer().notNull(),
    reserved: integer().notNull(),
  },
  (table) => [
    check("credit_balance_unit", sql`${table.unit} = 'audio-millisecond'`),
    check(
      "credit_balance_available",
      sql`${table.available} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check("credit_balance_reserved", sql`${table.reserved} BETWEEN 0 AND 9007199254740991`),
    check("credit_balance_total", sql`${table.available} + ${table.reserved} >= 0`),
  ],
);

export const creditOperations = sqliteTable(
  "credit_operations",
  {
    operationId: text("operation_id").primaryKey(),
    requestId: text("request_id").notNull().unique(),
    kind: text({ enum: ["grant", "reservation", "adjustment"] }).notNull(),
    unit: text({ enum: ["audio-millisecond"] }).notNull(),
    amount: integer().notNull(),
    state: text({ enum: ["completed", "reserved", "consumed", "released"] }).notNull(),
    cause: text().notNull(),
  },
  (table) => [
    check("credit_operation_kind", sql`${table.kind} IN ('grant', 'reservation', 'adjustment')`),
    check("credit_operation_unit", sql`${table.unit} = 'audio-millisecond'`),
    check("credit_operation_amount", sql`${table.amount} BETWEEN 1 AND 9007199254740991`),
    check(
      "credit_operation_state",
      sql`${table.state} IN ('completed', 'reserved', 'consumed', 'released')`,
    ),
    check(
      "credit_operation_transition",
      sql`(${table.kind} IN ('grant', 'adjustment') AND ${table.state} = 'completed') OR (${table.kind} = 'reservation' AND ${table.state} IN ('reserved', 'consumed', 'released'))`,
    ),
  ],
);

export const creditLedger = sqliteTable(
  "credit_ledger",
  {
    eventId: text("event_id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => creditOperations.operationId),
    eventKind: text("event_kind", {
      enum: ["grant", "reserve", "consume", "release", "adjustment"],
    }).notNull(),
    unit: text({ enum: ["audio-millisecond"] }).notNull(),
    amount: integer().notNull(),
    availableDelta: integer("available_delta").notNull(),
    reservedDelta: integer("reserved_delta").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    cause: text().notNull(),
  },
  (table) => [
    unique().on(table.operationId, table.eventKind),
    uniqueIndex("credit_terminal_settlement")
      .on(table.operationId)
      .where(sql`${table.eventKind} IN ('consume', 'release')`),
    check(
      "credit_ledger_kind",
      sql`${table.eventKind} IN ('grant', 'reserve', 'consume', 'release', 'adjustment')`,
    ),
    check("credit_ledger_unit", sql`${table.unit} = 'audio-millisecond'`),
    check("credit_ledger_amount", sql`${table.amount} BETWEEN 0 AND 9007199254740991`),
    check(
      "credit_ledger_deltas",
      sql`(${table.eventKind} = 'grant' AND ${table.availableDelta} = ${table.amount} AND ${table.reservedDelta} = 0) OR
    (${table.eventKind} = 'reserve' AND ${table.availableDelta} = -${table.amount} AND ${table.reservedDelta} = ${table.amount}) OR
    (${table.eventKind} = 'consume' AND ${table.availableDelta} + ${table.reservedDelta} = -${table.amount} AND ${table.reservedDelta} < 0) OR
    (${table.eventKind} = 'release' AND ${table.availableDelta} = ${table.amount} AND ${table.reservedDelta} = -${table.amount}) OR
    (${table.eventKind} = 'adjustment' AND ABS(${table.availableDelta}) = ${table.amount} AND ${table.reservedDelta} = 0)`,
    ),
  ],
);

/**
 * Defines the owner's audio segment table. Only the referenced conversion table differs between
 * owners, so each owner schema passes its own conversion ID column.
 */
export function defineAudioSegments(conversionIdColumn: () => AnySQLiteColumn) {
  return sqliteTable(
    "audio_segments",
    {
      conversionId: text("conversion_id").notNull().references(conversionIdColumn),
      sequence: integer().notNull(),
      narrationTextCharacters: integer("narration_text_characters").notNull(),
      estimatedMilliseconds: integer("estimated_milliseconds").notNull(),
      state: text({ enum: ["reserved", "settled", "released"] }).notNull(),
      actualMilliseconds: integer("actual_milliseconds").notNull(),
      chargedMilliseconds: integer("charged_milliseconds").notNull(),
      // The reservation operation currently backing this segment; a re-reservation replaces it.
      operationId: text("operation_id")
        .notNull()
        .unique()
        .references(() => creditOperations.operationId),
    },
    (table) => [
      primaryKey({ columns: [table.conversionId, table.sequence] }),
      check("audio_segment_sequence", sql`${table.sequence} >= 0`),
      check("audio_segment_characters", sql`${table.narrationTextCharacters} > 0`),
      check("audio_segment_estimate", sql`${table.estimatedMilliseconds} > 0`),
      check(
        "audio_segment_duration",
        sql`${table.chargedMilliseconds} >= 0 AND ${table.chargedMilliseconds} <= ${table.actualMilliseconds}`,
      ),
      check(
        "audio_segment_state",
        sql`(${table.state} = 'settled' AND ${table.actualMilliseconds} > 0) OR (${table.state} IN ('reserved', 'released') AND ${table.actualMilliseconds} = 0 AND ${table.chargedMilliseconds} = 0)`,
      ),
    ],
  );
}

export type AudioSegmentsTable = ReturnType<typeof defineAudioSegments>;
