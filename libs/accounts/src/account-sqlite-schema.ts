import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "account",
  {
    id: integer().primaryKey(),
    accountId: text("account_id").notNull().unique(),
    subject: text().notNull().unique(),
    createdAtMs: integer("created_at_ms").notNull(),
    state: text({ enum: ["active", "deletion_scheduled", "deleting"] }).notNull(),
    executionEpoch: integer("execution_epoch").notNull(),
    recoveryDeadlineMs: integer("recovery_deadline_ms"),
  },
  (table) => [
    check("account_singleton", sql`${table.id} = 1`),
    check("account_state", sql`${table.state} IN ('active', 'deletion_scheduled', 'deleting')`),
    check("account_epoch", sql`${table.executionEpoch} > 0`),
  ],
);

export const accountConversions = sqliteTable(
  "account_conversions",
  {
    conversionId: text("conversion_id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    sourceUrl: text("source_url").notNull(),
    fingerprint: text("request_fingerprint").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    status: text({ enum: ["pending", "ready", "failed"] }).notNull(),
    outcomeJson: text("outcome_json"),
    completedAtMs: integer("completed_at_ms"),
  },
  (table) => [
    check("account_conversion_status", sql`${table.status} IN ('pending', 'ready', 'failed')`),
    check(
      "account_conversion_outcome",
      sql`(${table.status} = 'pending' AND ${table.outcomeJson} IS NULL) OR (${table.status} IN ('ready', 'failed') AND ${table.outcomeJson} IS NOT NULL)`,
    ),
  ],
);

export const pendingJobs = sqliteTable(
  "pending_jobs",
  {
    jobId: text("job_id").primaryKey(),
    conversionId: text("conversion_id")
      .notNull()
      .unique()
      .references(() => accountConversions.conversionId),
    executionEpoch: integer("execution_epoch").notNull(),
    state: text({ enum: ["pending", "delivered"] }).notNull(),
  },
  (table) => [
    check("pending_job_epoch", sql`${table.executionEpoch} > 0`),
    check("pending_job_state", sql`${table.state} IN ('pending', 'delivered')`),
  ],
);

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

export const accountAudioSegments = sqliteTable(
  "account_audio_segments",
  {
    conversionId: text("conversion_id")
      .notNull()
      .references(() => accountConversions.conversionId),
    sequence: integer().notNull(),
    narrationTextCharacters: integer("narration_characters").notNull(),
    estimatedMilliseconds: integer("estimated_ms").notNull(),
    state: text({ enum: ["reserved", "settled", "released"] }).notNull(),
    actualMilliseconds: integer("actual_ms").notNull().default(0),
    chargedMilliseconds: integer("charged_ms").notNull().default(0),
    operationId: text("operation_id")
      .notNull()
      .unique()
      .references(() => creditOperations.operationId),
  },
  (table) => [
    primaryKey({ columns: [table.conversionId, table.sequence] }),
    check("account_segment_state", sql`${table.state} IN ('reserved', 'settled', 'released')`),
  ],
);

export const artifactWriters = sqliteTable(
  "artifact_writers",
  {
    writerId: text("writer_id").primaryKey(),
    executionEpoch: integer("execution_epoch").notNull(),
    prefix: text().notNull(),
    state: text({ enum: ["running", "drained", "uncertain"] }).notNull(),
    effect: text("unresolved_effect"),
    purpose: text().notNull(),
  },
  (table) => [
    check("artifact_writer_state", sql`${table.state} IN ('running', 'drained', 'uncertain')`),
  ],
);

export const deletionChallenges = sqliteTable("deletion_challenges", {
  challengeId: text("challenge_id").primaryKey(),
  executionEpoch: integer("execution_epoch").notNull(),
  state: text().notNull(),
  issuedAtMs: integer("issued_at_ms").notNull(),
  expiresAtMs: integer("expires_at_ms").notNull(),
  used: integer({ mode: "boolean" }).notNull().default(false),
});

export const deletionAttempts = sqliteTable("deletion_attempts", {
  attemptId: text("attempt_id").primaryKey(),
  json: text("payload_json").notNull(),
  state: text({ enum: ["scheduled", "restored", "deleting", "erased"] }).notNull(),
  delivered: integer({ mode: "boolean" }).notNull().default(false),
});

export const accountTombstone = sqliteTable(
  "account_tombstone",
  {
    id: integer().primaryKey(),
    attemptId: text("attempt_id").notNull(),
  },
  (table) => [check("account_tombstone_singleton", sql`${table.id} = 1`)],
);
