import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  ConversionPhase,
  AudiobookReference,
  ConversionMeasurements,
} from "@cup/conversion-contracts";
import { conversionPhaseOrder } from "@cup/conversion-contracts";
import {
  creditBalances,
  creditLedger,
  creditOperations,
  defineAudioSegments,
} from "@cup/duration-ledger";

// Re-exported so that the grant migrations create the shared duration ledger tables.
export { creditBalances, creditLedger, creditOperations };

/** Every conversion phase as an SQL list, so the CHECK below follows the enum. */
const CONVERSION_PHASE_SQL_LIST = sql.raw(
  conversionPhaseOrder.map((phase) => `'${phase}'`).join(", "),
);

export const grants = sqliteTable(
  "grant",
  {
    id: integer().primaryKey(),
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
    createdAtMs: integer("created_at_ms").notNull(),
    workflowStartedAtMs: integer("workflow_started_at_ms"),
    status: text({ enum: CONVERSION_STATUSES }).notNull(),
    lastStartedPhase: text("last_started_phase").$type<ConversionPhase>(),
    completedAtMs: integer("completed_at_ms"),
    title: text(),
    audiobookReference: text("audiobook_reference_json", {
      mode: "json",
    }).$type<AudiobookReference>(),
    // Set only for a ready conversion whose audiobook has a cover image; null otherwise.
    hasCoverImage: integer("has_cover_image", { mode: "boolean" }),
    measurements: text("measurements_json", { mode: "json" }).$type<ConversionMeasurements>(),
    providerUsage: text("provider_usage_json", { mode: "json" }).$type<Record<string, unknown>>(),
    failureCategory: text("failure_category", { enum: FAILURE_CATEGORIES }),
    explanation: text(),
    diagnosticReference: text("diagnostic_reference"),
    cleanupState: text("cleanup_state", { enum: CLEANUP_STATES }),
  },
  (table) => [
    check("conversion_status", sql`${table.status} IN ('pending', 'ready', 'failed')`),
    check("conversion_phase", sql`${table.lastStartedPhase} IN (${CONVERSION_PHASE_SQL_LIST})`),
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

export const audioSegments = defineAudioSegments(() => conversions.conversionId);

export const grantSqliteSchema = {
  audioSegments,
  conversions,
  creditBalances,
  creditLedger,
  creditOperations,
  grants,
};
