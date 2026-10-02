import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  ConversionPhase,
  AudiobookReference,
  ConversionMeasurements,
} from "@cup/conversion-contracts";
import type { SegmentUsage } from "@cup/conversion-contracts/duration-accounting";

export const grants = sqliteTable(
  "grant",
  {
    id: integer().primaryKey(),
    allowanceMilliseconds: integer("allowance_milliseconds").notNull().default(7_200_000),
    grantId: text("grant_id").notNull().unique(),
    createdAtMs: integer("created_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    revokedAtMs: integer("revoked_at_ms"),
    credentialVerifier: text("credential_verifier"),
    credentialIssuedAtMs: integer("credential_issued_at_ms"),
    sessionSigningKey: text("session_signing_key").notNull(),
    signingKeyGeneration: integer("signing_key_generation").notNull(),
    registrySnapshotRevision: integer("projection_revision").notNull(),
    registryConfirmedSnapshotRevision: integer("registry_confirmed_revision").notNull(),
  },
  (table) => [
    check("grant_allowance", sql`${table.allowanceMilliseconds} > 0`),
    check("grant_singleton", sql`${table.id} = 1`),
    check("grant_expiry", sql`${table.expiresAtMs} > ${table.createdAtMs}`),
    check("grant_signing_key_generation", sql`${table.signingKeyGeneration} > 0`),
    check("grant_registry_snapshot_revision", sql`${table.registrySnapshotRevision} > 0`),
    check(
      "grant_registry_confirmed_snapshot_revision",
      sql`${table.registryConfirmedSnapshotRevision} >= 0`,
    ),
  ],
);

const CONVERSION_STATUSES = ["pending", "ready", "failed"] as const;
const FAILURE_CATEGORIES = [
  "workflow-start",
  "source-preparation",
  "content-selection",
  "content-limit",
  "narration-synthesis",
  "audiobook-assembly",
  "workflow-platform",
  "internal",
] as const;
const CLEANUP_STATES = ["pending", "complete", "cleanup_failed"] as const;

export const conversions = sqliteTable(
  "conversions",
  {
    conversionId: text("conversion_id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    sourceUrl: text("source_url").notNull(),
    acceptedAtMs: integer("accepted_at_ms").notNull(),
    workflowStartedAtMs: integer("workflow_started_at_ms"),
    status: text({ enum: CONVERSION_STATUSES }).notNull(),
    lastStartedPhase: text("last_started_phase").$type<ConversionPhase>(),
    completedAtMs: integer("completed_at_ms"),
    title: text(),
    audiobookReference: text("audiobook_reference_json", {
      mode: "json",
    }).$type<AudiobookReference>(),
    measurements: text("measurements_json", { mode: "json" }).$type<ConversionMeasurements>(),
    providerUsage: text("provider_usage_json", { mode: "json" }).$type<Record<string, unknown>>(),
    failureCategory: text("failure_category", { enum: FAILURE_CATEGORIES }),
    explanation: text(),
    diagnosticReference: text("diagnostic_reference"),
    cleanupState: text("cleanup_state", { enum: CLEANUP_STATES }),
  },
  (table) => [
    check("conversion_status", sql`${table.status} IN ('pending', 'ready', 'failed')`),
    check(
      "conversion_phase",
      sql`${table.lastStartedPhase} IN ('conversion-start', 'source-material-preparation', 'narration-content-selection', 'narration-document-creation', 'audio-segment-production', 'audiobook-assembly', 'audiobook-storage', 'finalization')`,
    ),
    check(
      "conversion_failure_category",
      sql`${table.failureCategory} IS NULL OR ${table.failureCategory} IN ('workflow-start', 'source-preparation', 'content-selection', 'content-limit', 'narration-synthesis', 'audiobook-assembly', 'workflow-platform', 'internal')`,
    ),
    check(
      "conversion_cleanup_state",
      sql`${table.cleanupState} IS NULL OR ${table.cleanupState} IN ('pending', 'complete', 'cleanup_failed')`,
    ),
    check(
      "conversion_reference_json",
      sql`${table.audiobookReference} IS NULL OR json_valid(${table.audiobookReference})`,
    ),
    check(
      "conversion_measurements_json",
      sql`${table.measurements} IS NULL OR json_valid(${table.measurements})`,
    ),
    check(
      "conversion_usage_json",
      sql`${table.providerUsage} IS NULL OR json_valid(${table.providerUsage})`,
    ),
    check(
      "conversion_terminal_outcome",
      sql`(
        ${table.lastStartedPhase} IS NOT NULL AND (
          (${table.status} = 'pending' AND ${table.completedAtMs} IS NULL AND ${table.audiobookReference} IS NULL AND ${table.failureCategory} IS NULL AND ${table.explanation} IS NULL)
          OR (${table.status} = 'ready' AND ${table.completedAtMs} IS NOT NULL AND ${table.title} IS NOT NULL AND ${table.audiobookReference} IS NOT NULL AND ${table.failureCategory} IS NULL AND ${table.explanation} IS NULL)
          OR (${table.status} = 'failed' AND ${table.completedAtMs} IS NOT NULL AND ${table.audiobookReference} IS NULL AND ${table.failureCategory} IS NOT NULL AND ${table.explanation} IS NOT NULL)
        )
      )`,
    ),
  ],
);

export const segmentUsage = sqliteTable(
  "segment_usage",
  {
    conversionId: text("conversion_id")
      .notNull()
      .references(() => conversions.conversionId),
    sequence: integer().notNull(),
    narrationTextCharacters: integer("narration_text_characters").notNull(),
    estimatedMilliseconds: integer("estimated_milliseconds").notNull(),
    state: text({ enum: ["reserved", "settled", "released"] })
      .$type<SegmentUsage["state"]>()
      .notNull(),
    actualMilliseconds: integer("actual_milliseconds").notNull(),
    chargedMilliseconds: integer("charged_milliseconds").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversionId, table.sequence] }),
    check("segment_usage_sequence", sql`${table.sequence} >= 0`),
    check("segment_usage_characters", sql`${table.narrationTextCharacters} > 0`),
    check("segment_usage_estimate", sql`${table.estimatedMilliseconds} > 0`),
    check(
      "segment_usage_duration",
      sql`${table.chargedMilliseconds} >= 0 AND ${table.chargedMilliseconds} <= ${table.actualMilliseconds}`,
    ),
    check(
      "segment_usage_state",
      sql`(${table.state} = 'settled' AND ${table.actualMilliseconds} > 0) OR (${table.state} IN ('reserved', 'released') AND ${table.actualMilliseconds} = 0 AND ${table.chargedMilliseconds} = 0)`,
    ),
  ],
);

export const startAttempts = sqliteTable("start_attempts", {
  id: integer().primaryKey({ autoIncrement: true }),
  attemptedAtMs: integer("attempted_at_ms").notNull(),
});

export const grantSqliteSchema = {
  conversions,
  grants,
  segmentUsage,
  startAttempts,
};
