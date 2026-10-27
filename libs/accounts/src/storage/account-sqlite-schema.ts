import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { AudiobookReference } from "@cup/conversion-contracts";
import { defineAudioSegments } from "@cup/duration-ledger";

// Re-exported so that the account migrations create the shared duration ledger tables.
export { creditBalances, creditLedger, creditOperations } from "@cup/duration-ledger";

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
    // The duration ledger revision the registry last confirmed for its usage projection.
    registryConfirmedRevision: integer("registry_confirmed_revision").notNull().default(0),
  },
  (table) => [
    check("account_singleton", sql`${table.id} = 1`),
    check("account_state", sql`${table.state} IN ('active', 'deletion_scheduled', 'deleting')`),
    check("account_epoch", sql`${table.executionEpoch} > 0`),
    check("account_registry_confirmed_revision", sql`${table.registryConfirmedRevision} >= 0`),
  ],
);

export const accountConversions = sqliteTable(
  "account_conversions",
  {
    conversionId: text("conversion_id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    sourceUrl: text("source_url").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    status: text({ enum: ["pending", "ready", "failed"] }).notNull(),
    completedAtMs: integer("completed_at_ms"),
    title: text(),
    audiobookReference: text("audiobook_reference_json", {
      mode: "json",
    }).$type<AudiobookReference>(),
    // Set only for a ready conversion whose audiobook has a cover image; null otherwise.
    hasCoverImage: integer("has_cover_image", { mode: "boolean" }),
    failureCategory: text("failure_category"),
    explanation: text(),
  },
  (table) => [
    check("account_conversion_status", sql`${table.status} IN ('pending', 'ready', 'failed')`),
    check(
      "account_conversion_reference_json",
      sql`${table.audiobookReference} IS NULL OR json_valid(${table.audiobookReference})`,
    ),
    check(
      "account_conversion_outcome",
      sql`(${table.status} = 'pending' AND ${table.completedAtMs} IS NULL AND ${table.title} IS NULL AND ${table.audiobookReference} IS NULL AND ${table.hasCoverImage} IS NULL AND ${table.failureCategory} IS NULL AND ${table.explanation} IS NULL)
        OR (${table.status} = 'ready' AND ${table.completedAtMs} IS NOT NULL AND ${table.title} IS NOT NULL AND ${table.audiobookReference} IS NOT NULL AND ${table.failureCategory} IS NULL AND ${table.explanation} IS NULL)
        OR (${table.status} = 'failed' AND ${table.completedAtMs} IS NOT NULL AND ${table.title} IS NULL AND ${table.audiobookReference} IS NULL AND ${table.hasCoverImage} IS NULL AND ${table.failureCategory} IS NOT NULL AND ${table.explanation} IS NOT NULL)`,
    ),
  ],
);

export const accountPlaybackPositions = sqliteTable(
  "account_playback_positions",
  {
    conversionId: text("conversion_id").primaryKey(),
    synchronizationUnitId: text("synchronization_unit_id").notNull(),
    offsetMilliseconds: integer("offset_milliseconds").notNull(),
  },
  (table) => [check("playback_offset", sql`${table.offsetMilliseconds} >= 0`)],
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

export const audioSegments = defineAudioSegments(() => accountConversions.conversionId);

export const artifactWriters = sqliteTable(
  "artifact_writers",
  {
    writerId: text("writer_id").primaryKey(),
    executionEpoch: integer("execution_epoch").notNull(),
    prefix: text().notNull(),
    state: text({ enum: ["running", "drained", "uncertain"] }).notNull(),
    effect: text("unresolved_effect"),
  },
  (table) => [
    check("artifact_writer_state", sql`${table.state} IN ('running', 'drained', 'uncertain')`),
  ],
);

export const deletionChallenges = sqliteTable(
  "deletion_challenges",
  {
    challengeId: text("challenge_id").primaryKey(),
    executionEpoch: integer("execution_epoch").notNull(),
    // Challenges are refused once deletion has started, so they never record `deleting`.
    state: text({ enum: ["active", "deletion_scheduled"] }).notNull(),
    issuedAtMs: integer("issued_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    used: integer({ mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    check("deletion_challenge_state", sql`${table.state} IN ('active', 'deletion_scheduled')`),
    check("deletion_challenge_used", sql`${table.used} IN (0, 1)`),
  ],
);

export const deletionAttempts = sqliteTable(
  "deletion_attempts",
  {
    attemptId: text("attempt_id").primaryKey(),
    json: text("payload_json").notNull(),
    // Account erasure deletes these rows, so the stored state never becomes `erased`.
    state: text({ enum: ["scheduled", "restored", "deleting"] }).notNull(),
    delivered: integer({ mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    check("deletion_attempt_state", sql`${table.state} IN ('scheduled', 'restored', 'deleting')`),
    check("deletion_attempt_delivered", sql`${table.delivered} IN (0, 1)`),
  ],
);

export const accountTombstone = sqliteTable(
  "account_tombstone",
  {
    id: integer().primaryKey(),
    attemptId: text("attempt_id").notNull(),
  },
  (table) => [check("account_tombstone_singleton", sql`${table.id} = 1`)],
);
